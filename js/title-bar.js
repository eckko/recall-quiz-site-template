/*
 * title-bar.js
 * The bar at the top of the quiz, with a drawer on each side.
 *
 * Home screen:      menu | book name | list
 * Question screen:  menu | "Chapter 1 · Name" over the topic | list
 *
 * Left drawer (both screens): the chapters and their topics. A chapter
 * opens and closes with its chevron. Tapping a name scrolls the home
 * screen to it; from a session it asks "End this session?" first.
 * Right drawer, home screen: the chapters (closed to start with, tap one
 * to open it) and their ideas, with the New / Learning / Solid chip.
 * Tapping an idea scrolls to it and opens it.
 * Right drawer, in a session: every step of the session with a mark
 * (right, partly, missed, current, not seen yet). An unseen question
 * is jumped to; an answered one opens read-only, so it is not
 * recorded twice.
 *
 * The markup of the bar and the drawers is in index.html; this file
 * fills it and wires it.
 */
(function setUpTitleBar(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;

  /** Longest question text shown in the session list */
  const LIST_TEXT_LENGTH = 80;
  const MARKS = {
    got: { symbol: "✓", name: "Right" },
    part: { symbol: "◐", name: "Partly right" },
    miss: { symbol: "✕", name: "Missed" },
    seen: { symbol: "✓", name: "Read" },
    current: { symbol: "●", name: "On screen now" },
    unseen: { symbol: "○", name: "Not seen yet" },
  };
  const LEAVE_SESSION_TEXT = "End this session?";

  /** "home", "session" or "results": what the bar shows */
  let view = "home";
  /** The question on screen, in a session */
  let shownQuestion = null;

  // ----------------------------------------------------------- the bar

  /**
   * Show the home bar: the book name in the middle.
   */
  function showHome() {
    view = "home";
    shownQuestion = null;
    findElement("ideas-button").classList.remove("hidden");
    findElement("book-title").classList.remove("hidden");
    findElement("title-bar-session").classList.add("hidden");
    closeDrawers();
  }

  /**
   * Show the question bar: chapter over topic in the middle.
   * @param {object} question  the step on screen
   */
  function showQuestion(question) {
    view = "session";
    shownQuestion = question;
    findElement("ideas-button").classList.remove("hidden");
    findElement("book-title").classList.add("hidden");
    findElement("title-bar-session").classList.remove("hidden");
    findElement("title-bar-kicker").textContent =
      quiz.book.unitFullName(question).replace(", ", " · ");
    findElement("title-bar-topic").textContent = question.section;
    closeDrawers();
  }

  /** The session has ended: the bar keeps the book name, and the
      session list goes (its steps can no longer be opened). */
  function showResults() {
    view = "results";
    shownQuestion = null;
    findElement("ideas-button").classList.add("hidden");
    findElement("book-title").classList.remove("hidden");
    findElement("title-bar-session").classList.add("hidden");
    closeDrawers();
  }

  // ----------------------------------------------------------- drawers

  /**
   * Open one drawer, filled for what is on screen.
   * @param {"contents"|"ideas"} which
   */
  function openDrawer(which) {
    closeDrawers();
    const drawer = findElement(which + "-drawer");
    const list = findElement(which + "-drawer-list");
    list.textContent = "";
    if (which === "contents") {
      fillContents(list);
    } else {
      fillRight(list);
    }
    drawer.classList.remove("hidden");
    findElement("drawer-scrim").classList.remove("hidden");
    findElement(which + "-button").setAttribute("aria-expanded", "true");
    const current = list.querySelector(".is-current");
    if (current) {
      current.scrollIntoView({ block: "center" });
    }
  }

  /** Close both drawers. */
  function closeDrawers() {
    ["contents", "ideas"].forEach(function close(which) {
      findElement(which + "-drawer").classList.add("hidden");
      findElement(which + "-button").setAttribute("aria-expanded", "false");
    });
    findElement("drawer-scrim").classList.add("hidden");
  }

  /** @returns {boolean} true if a drawer is open */
  function isDrawerOpen() {
    return !findElement("drawer-scrim").classList.contains("hidden");
  }

  /**
   * One tappable row of a drawer.
   * @param {string} text
   * @param {string} className
   * @param {function(): void} onTap
   * @returns {HTMLButtonElement}
   */
  function createDrawerRow(text, className, onTap) {
    return createButton(text, "drawer-row " + className, onTap);
  }

  // ----------------------------------------------- the chapters and topics

  /**
   * The left drawer: chapters, each with its topics. A chapter opens and
   * closes; the one the question on screen belongs to starts open.
   * @param {HTMLElement} list
   */
  function fillContents(list) {
    list.appendChild(createExpandTools(list));
    quiz.book.unitIds.forEach(function addUnit(unitId) {
      const title = quiz.book.unitTitles[unitId];
      const topics = topicsOfUnit(unitId);
      const group = createChapterGroup({
        label: unitId + (title ? " · " + title : ""),
        isCurrent: isCurrentUnit(unitId),
        isOpen: isCurrentUnit(unitId),
        canOpen: topics.length > 0,
        onGo: function goToUnit() {
          goToHome({ unitId });
        },
      });
      topics.forEach(function addTopic(topic) {
        const isCurrent = isCurrentUnit(unitId) &&
          shownQuestion.section === topic;
        group.body.appendChild(createDrawerRow(topic,
          "is-topic" + (isCurrent ? " is-current" : ""),
          function goToTopic() {
            goToHome({ unitId, section: topic });
          }));
      });
      list.appendChild(group.element);
    });
  }

  /**
   * A chapter that opens and closes. Its name goes to the chapter (when
   * onGo is given, otherwise the name opens and closes it too); the
   * chevron button always opens and closes.
   * @param {{label: string, isCurrent: boolean, isOpen: boolean,
   *   canOpen: boolean, onGo?: function(): void}} options
   * @returns {{element: HTMLElement, body: HTMLElement}}
   */
  function createChapterGroup(options) {
    const element = createElement("div", "drawer-chapter");
    const head = createElement("div", "drawer-chapter-head");
    const body = createElement("div", "drawer-chapter-body");
    const toggle = createButton("", "drawer-toggle", function flip() {
      setGroupOpen(element, !element.classList.contains("is-open"));
    });
    const nameRow = createDrawerRow(options.label,
      "is-chapter" + (options.isCurrent ? " is-current" : ""),
      options.onGo || function flipFromName() {
        toggle.click();
      });
    head.appendChild(nameRow);
    if (options.canOpen) {
      head.appendChild(toggle);
    }
    element.appendChild(head);
    element.appendChild(body);
    element.toggleButton = toggle;
    element.chapterName = options.label;
    setGroupOpen(element, options.isOpen && options.canOpen);
    return { element, body };
  }

  /**
   * Open or close one chapter of a drawer.
   * @param {HTMLElement} group
   * @param {boolean} open
   */
  function setGroupOpen(group, open) {
    group.classList.toggle("is-open", open);
    group.querySelector(".drawer-chapter-body").hidden = !open;
    group.toggleButton.setAttribute("aria-expanded", String(open));
    group.toggleButton.setAttribute("aria-label",
      (open ? "Close " : "Open ") + group.chapterName);
  }

  /**
   * "Open all" and "Close all" for the chapters of a drawer list.
   * @param {HTMLElement} list
   * @returns {HTMLElement}
   */
  function createExpandTools(list) {
    const tools = createElement("div", "drawer-tools");
    [["Open all", true], ["Close all", false]].forEach(
      function addTool(tool) {
        tools.appendChild(createButton(tool[0], "", function setAll() {
          list.querySelectorAll(".drawer-chapter").forEach(
            function apply(group) {
              if (group.querySelector(".drawer-toggle")) {
                setGroupOpen(group, tool[1]);
              }
            });
        }));
      });
    return tools;
  }

  /**
   * @param {string} unitId
   * @returns {boolean} true if the question on screen is in this chapter
   */
  function isCurrentUnit(unitId) {
    return Boolean(shownQuestion) && shownQuestion.unit === unitId;
  }

  /**
   * The topics of a chapter, once each, in book order.
   * @param {string} unitId
   * @returns {string[]}
   */
  function topicsOfUnit(unitId) {
    const topics = [];
    quiz.book.questionsInUnit(unitId).forEach(function note(question) {
      if (question.section && !topics.includes(question.section)) {
        topics.push(question.section);
      }
    });
    return topics;
  }

  // ------------------------------------------------ the chapters and ideas

  /**
   * The right drawer: the ideas on the home screen, the session in a
   * session.
   * @param {HTMLElement} list
   */
  function fillRight(list) {
    findElement("ideas-drawer-title").textContent =
      view === "home" ? "Ideas" : "This session";
    if (view === "home") {
      fillIdeas(list);
    } else {
      fillSession(list);
    }
  }

  /**
   * The ideas of every chapter with their status chip.
   * @param {HTMLElement} list
   */
  function fillIdeas(list) {
    if (!quiz.learning.hasConcepts()) {
      list.appendChild(createElement("p", "drawer-note",
        "This book has no teaching ideas. Use the other menu to jump " +
        "to a " + quiz.book.labels.unit.toLowerCase() + " or topic."));
      return;
    }
    list.appendChild(createExpandTools(list));
    quiz.book.unitIds.forEach(function addUnit(unitId) {
      const ideas = quiz.learning.concepts().filter(
        function inUnit(concept) {
          return concept.unit === unitId;
        });
      if (!ideas.length) {
        return;
      }
      const group = createChapterGroup({
        label: unitId + (quiz.book.unitTitles[unitId] ?
          " · " + quiz.book.unitTitles[unitId] : ""),
        isCurrent: false,
        isOpen: false,
        canOpen: true,
      });
      ideas.forEach(function addIdea(concept) {
        group.body.appendChild(createIdeaRow(concept));
      });
      list.appendChild(group.element);
    });
  }

  /**
   * One idea: its title and status chip.
   * @param {object} concept
   * @returns {HTMLElement}
   */
  function createIdeaRow(concept) {
    const status = quiz.learning.statusOf(concept.id);
    const row = createDrawerRow("", "is-idea", function goToIdea() {
      goToHome({ unitId: concept.unit, conceptId: concept.id });
    });
    row.appendChild(createElement("span", "drawer-row-text", concept.title));
    row.appendChild(createElement("span", "status-chip is-" + status,
      quiz.learning.statusName(status)));
    return row;
  }

  // ------------------------------------------------------ the session

  /**
   * Every step of the session, with its mark.
   * @param {HTMLElement} list
   */
  function fillSession(list) {
    const state = quiz.session.state;
    list.appendChild(createElement("p", "drawer-note",
      state.scopeName + " · " + state.questions.length + " steps"));
    list.appendChild(createLegend());
    state.questions.forEach(function addStep(step, index) {
      list.appendChild(createSessionRow(step, index));
    });
    list.appendChild(createElement("p", "drawer-note",
      "Tap a question you have not seen to jump to it. A question you " +
      "have answered opens read-only and is not recorded again."));
  }

  /** @returns {HTMLElement} what each mark means */
  function createLegend() {
    const legend = createElement("p", "drawer-legend");
    ["got", "part", "miss", "current", "unseen"].forEach(
      function add(key) {
        legend.appendChild(createElement("span", null,
          MARKS[key].symbol + " " + MARKS[key].name));
      });
    return legend;
  }

  /**
   * One step of the session.
   * @param {object} step  a question or a concept card
   * @param {number} index
   * @returns {HTMLElement}
   */
  function createSessionRow(step, index) {
    const state = quiz.session.state;
    const isCurrent = index === state.currentIndex && view === "session";
    const mark = MARKS[isCurrent ? "current" :
      (state.results[index] || "unseen")];
    const row = createDrawerRow("", "is-step" +
      (isCurrent ? " is-current" : ""), function openStep() {
      closeDrawers();
      quiz.session.jumpTo(index);
    });
    const symbol = createElement("span", "drawer-mark", mark.symbol);
    symbol.setAttribute("role", "img");
    symbol.setAttribute("aria-label", mark.name);
    row.appendChild(symbol);
    row.appendChild(createElement("span", "drawer-row-text",
      stepLabel(step, index)));
    return row;
  }

  /**
   * A question's text with its formula marks removed, so a cut-off
   * label never shows half a formula.
   * @param {string} text
   * @returns {string}
   */
  function withoutFormulaMarks(text) {
    return String(text || "")
      .replace(/\\[()[\]]/g, "")
      .replace(/\\[a-zA-Z]+/g, " ")
      .replace(/[{}^_$]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * "3. Warm-up · text", "4. Card · idea" or "5. text".
   * @param {object} step
   * @param {number} index
   * @returns {string}
   */
  function stepLabel(step, index) {
    let prefix = "";
    if (step.kind === "lesson") {
      prefix = "Card · ";
    } else if (step.isPretestRun) {
      prefix = "Warm-up · ";
    }
    const text = withoutFormulaMarks(step.q);
    const short = text.length > LIST_TEXT_LENGTH
      ? text.slice(0, LIST_TEXT_LENGTH).trim() + "…" : text;
    return (index + 1) + ". " + prefix + short;
  }

  // ------------------------------------------------- going to the home screen

  /**
   * Show the home screen (asking first if a session is running) and
   * scroll it to a chapter, topic or idea.
   * @param {{unitId: string, section?: string, conceptId?: string}} target
   */
  function goToHome(target) {
    if (view === "session" && !confirm(LEAVE_SESSION_TEXT)) {
      return;
    }
    closeDrawers();
    if (view !== "home") {
      quiz.session.returnHome();
    }
    scrollHomeTo(target);
  }

  /**
   * Open and scroll to the row for a target on the home screen. If the
   * row is not there (the reader hid that panel), the page stays at
   * the top.
   * @param {{unitId: string, section?: string, conceptId?: string}} target
   */
  function scrollHomeTo(target) {
    const panel = findElement("where-you-stand");
    const row = findRow(panel, target);
    if (!row) {
      window.scrollTo({ top: 0 });
      return;
    }
    if (panel.classList.contains("is-collapsed")) {
      panel.querySelector(".panel-toggle").click();
    }
    for (let part = row; part && part !== panel; part = part.parentElement) {
      if (part.tagName === "DETAILS" && !part.classList.contains("flag-bar")) {
        part.open = true;
      }
    }
    row.scrollIntoView({ block: "start",
      behavior: quiz.helpers.prefersReducedMotion() ? "auto" : "smooth" });
  }

  /**
   * The most exact row of the home screen for a target.
   * @param {HTMLElement} panel  "Where you stand"
   * @param {{unitId: string, section?: string, conceptId?: string}} target
   * @returns {HTMLElement|null}
   */
  function findRow(panel, target) {
    const unitRow = Array.from(panel.querySelectorAll(".unit-progress"))
      .find(function isUnit(row) {
        return row.dataset.unitId === target.unitId;
      });
    if (!unitRow) {
      return null;
    }
    if (target.conceptId) {
      const idea = Array.from(unitRow.querySelectorAll(".concept-row"))
        .find(function isIdea(row) {
          return row.dataset.conceptId === target.conceptId;
        });
      return idea || unitRow;
    }
    if (target.section) {
      const topic = Array.from(unitRow.querySelectorAll(".section-row"))
        .find(function isTopic(row) {
          return row.dataset.section === target.section;
        });
      return topic || unitRow;
    }
    return unitRow;
  }

  // ------------------------------------------------------------ wiring

  /** Connect the buttons, the scrim and the Escape key. */
  function setUp() {
    findElement("contents-button").addEventListener("click",
      function toggleContents() {
        toggleDrawer("contents");
      });
    findElement("ideas-button").addEventListener("click",
      function toggleIdeas() {
        toggleDrawer("ideas");
      });
    findElement("drawer-scrim").addEventListener("click", closeDrawers);
    document.querySelectorAll(".drawer-close").forEach(
      function connect(button) {
        button.addEventListener("click", closeDrawers);
      });
    document.addEventListener("keydown", function closeOnEscape(event) {
      if (event.key === "Escape" && isDrawerOpen()) {
        closeDrawers();
      }
    });
    document.addEventListener("recallquiz:question-shown",
      function onQuestion(event) {
        showQuestion(event.detail.question);
      });
    document.addEventListener("recallquiz:home-shown", showHome);
    document.addEventListener("recallquiz:results-shown", showResults);
  }

  /**
   * Open a drawer, or close it if it is the one open.
   * @param {"contents"|"ideas"} which
   */
  function toggleDrawer(which) {
    const isOpen = !findElement(which + "-drawer").classList.contains(
      "hidden");
    if (isOpen) {
      closeDrawers();
    } else {
      openDrawer(which);
    }
  }

  setUp();

  quiz.titleBar = { showHome, showQuestion, showResults, closeDrawers };
})((window.RecallQuiz = window.RecallQuiz || {}));
