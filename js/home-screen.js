/*
 * home-screen.js
 * Draws the start screen: the book title, the progress ring and counts,
 * the day streak, "Your recent results" and "Where you stand".
 */
(function setUpHomeScreen(quiz) {
  "use strict";

  const { findElement, createElement, createButton, countWithWord,
    formatOneDecimal } = quiz.helpers;

  /** Length of the progress ring's circle (2 * pi * radius 42) */
  const RING_CIRCUMFERENCE = 263.9;
  const VERDICT_NAMES = {
    excellent: "Excellent", pass: "Pass", fail: "Needs work",
  };

  /** Fill in the parts that only change when a new book is loaded. */
  function showBookDetails() {
    const book = quiz.book;
    const questionCount = book.allQuestions().length;
    const unitCount = book.unitIds.length;
    const unitsText = countWithWord(unitCount,
      book.labels.unit.toLowerCase(), book.labels.units);
    findElement("book-title").textContent = book.data.book;
    document.title = book.data.book;
    findElement("book-summary").textContent = quiz.learning.hasConcepts()
      ? countWithWord(quiz.learning.concepts().length, "idea") + ", " +
        countWithWord(questionCount, "question") + ", " + unitsText +
        ". Pick any idea, in any order."
      : countWithWord(questionCount, "question") + " across " + unitsText +
        ". Recall first, then check.";
    showBookBlurb();
    quiz.scopePicker.fill();
    showKeepGoingFor(quiz.learning.hasConcepts());
  }

  /** The one-sentence summary of the whole book, if the bank has one. */
  function showBookBlurb() {
    const blurb = findElement("book-blurb");
    const text = quiz.book.data.summary;
    blurb.textContent = text || "";
    blurb.classList.toggle("hidden", !text);
  }

  /**
   * Show "Keep me going" for a book with ideas. A book without ideas
   * only has the custom practice (js/home-layout.js opens it, unless the
   * reader chose otherwise).
   * @param {boolean} hasConcepts
   */
  function showKeepGoingFor(hasConcepts) {
    findElement("keep-going-block").classList.toggle("hidden", !hasConcepts);
    findElement("quick-session-button")
      .classList.toggle("hidden", !hasConcepts);
  }

  /** Redraw everything that depends on the reader's progress. */
  function refresh() {
    showProgressOverview();
    showTodaySummary();
    showDayStreak();
    quiz.settings.updateReadySummary();
    showWhereYouStand();
    showRecentResults();
  }

  // ---------------------------------------------------------- overview

  /** The ring (percent solid) and the Solid / Learning / Not seen counts */
  function showProgressOverview() {
    const questions = quiz.book.allQuestions();
    const solidCount = countWhere(questions, quiz.memory.isSolid);
    const learningCount = countWhere(questions, quiz.memory.isLearning);
    const notSeenCount = questions.length - solidCount - learningCount;
    const percentSolid = questions.length
      ? Math.round((100 * solidCount) / questions.length)
      : 0;

    findElement("progress-ring-arc").style.strokeDashoffset =
      String(RING_CIRCUMFERENCE * (1 - percentSolid / 100));
    findElement("progress-ring-text").textContent = percentSolid + "%";

    const tally = findElement("progress-tally");
    tally.textContent = "";
    [
      { label: "Solid", count: solidCount },
      { label: "Learning", count: learningCount },
      { label: "Not seen", count: notSeenCount },
    ].forEach(function addCount(entry) {
      const box = createElement("div");
      box.appendChild(createElement("b", null, String(entry.count)));
      box.appendChild(createElement("span", null, entry.label));
      tally.appendChild(box);
    });
  }

  /** "Today you answered 4. 2 to revisit." */
  function showTodaySummary() {
    const questions = quiz.book.allQuestions();
    const waitingCount = countWhere(questions, quiz.memory.isWaitingForReview);
    const waitingText = waitingCount
      ? waitingCount + " to revisit."
      : "Nothing waiting to revisit.";
    findElement("today-summary").textContent =
      "Today you answered " + quiz.memory.countAnsweredToday() + ". " +
      waitingText;
  }

  /**
   * How many questions pass a test about their id.
   * @param {object[]} questions
   * @param {function(string): boolean} test
   * @returns {number}
   */
  function countWhere(questions, test) {
    return questions.filter(function passes(question) {
      return test(question.id);
    }).length;
  }

  /**
   * "3 days in a row" and "12 days practised". The second never goes
   * down, so a missed day does not erase the habit.
   */
  function showDayStreak() {
    const streakElement = findElement("day-streak");
    const days = quiz.memory.currentDayStreak();
    streakElement.textContent = "";
    streakElement.appendChild(
      createElement("b", null, countWithWord(days, "day")));
    streakElement.appendChild(document.createTextNode(" in a row"));
    streakElement.appendChild(createElement("small", "days-practised",
      countWithWord(quiz.memory.countDaysPracticed(), "day") +
      " practised"));
  }

  // ---------------------------------------------------------- recent

  /** The last five results, newest first. Hidden when there are none. */
  function showRecentResults() {
    const panel = findElement("recent-results");
    const results = quiz.progress.saved.recentResults;
    panel.textContent = "";
    if (results.length === 0) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    panel.appendChild(createElement("h2", null, "Your recent results"));
    quiz.layout.makeFoldable(panel, "recent");
    results.forEach(function addResultRow(result) {
      panel.appendChild(createRecentResultRow(result));
    });
  }

  /**
   * One row: verdict chip, what was practised and when, and the score.
   * @param {object} result  see progress-storage.js
   * @returns {HTMLElement}
   */
  function createRecentResultRow(result) {
    const row = createElement("div", "history-row");
    row.appendChild(createElement("span", "verdict-chip " + result.verdict,
      VERDICT_NAMES[result.verdict]));

    const when = createElement("div", "history-when");
    when.appendChild(createElement("b", null, describeSession(result)));
    when.appendChild(document.createTextNode(
      formatDateAndTime(new Date(result.finishedAt))));
    row.appendChild(when);

    const score = createElement("div", "history-score",
      formatOneDecimal(result.percent) + "%");
    score.appendChild(createElement("small", null,
      formatOneDecimal(result.marks) + " of " + result.questionCount +
      " marks"));
    row.appendChild(score);
    return row;
  }

  /**
   * e.g. "Whole book, 15 min session, 30s each"
   * @param {object} result
   * @returns {string}
   */
  function describeSession(result) {
    let text = result.scopeName;
    if (result.sessionMinutes) {
      text += ", " + result.sessionMinutes + " min session";
    }
    if (result.secondsPerQuestion) {
      text += ", " + result.secondsPerQuestion + "s each";
    }
    return text;
  }

  /**
   * e.g. "5 Oct, 14:30" (in the reader's own date style)
   * @param {Date} date
   * @returns {string}
   */
  function formatDateAndTime(date) {
    const day = date.toLocaleDateString(undefined,
      { day: "numeric", month: "short" });
    const time = date.toLocaleTimeString(undefined,
      { hour: "2-digit", minute: "2-digit" });
    return day + ", " + time;
  }

  // ---------------------------------------------------------- gaps

  /** Where the chosen view (structure or ideas) is remembered. */
  const VIEW_STORAGE_KEY = "recall-quiz-home-view";
  const VIEWS = ["structure", "ideas"];

  /**
   * The view for the chapter list: ?view=ideas in the address wins,
   * then the choice saved in this browser, then "structure".
   * @returns {"structure"|"ideas"}
   */
  function currentView() {
    const wanted = new URLSearchParams(window.location.search).get("view");
    if (VIEWS.includes(wanted)) {
      return wanted;
    }
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      return VIEWS.includes(saved) ? saved : "structure";
    } catch (storageError) {
      return "structure";
    }
  }

  /**
   * Remember the chosen view and redraw the list.
   * @param {"structure"|"ideas"} view
   */
  function chooseView(view) {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch (storageError) {
      // Storage blocked: the choice lasts until the page is reloaded.
    }
    chosenView = view;
    showWhereYouStand();
  }

  /** The view picked in this page, or null before the first pick. */
  let chosenView = null;

  /**
   * The two buttons that switch between the chapter structure and the
   * ideas.
   * @param {"structure"|"ideas"} view  the view showing now
   * @returns {HTMLElement}
   */
  function createViewSwitch(view) {
    const group = createElement("div", "choice-group view-switch");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "How to list this book");
    [["structure", "Chapter structure"], ["ideas", "Ideas"]].forEach(
      function addButton(entry) {
        const button = createButton(entry[1], "", function pick() {
          chooseView(entry[0]);
        });
        button.setAttribute("data-view", entry[0]);
        button.setAttribute("aria-pressed", String(entry[0] === view));
        group.appendChild(button);
      });
    return group;
  }

  /**
   * Progress per chapter, opening up to progress per topic. A switch
   * chooses between the chapter structure (chapters, then their topics,
   * with the ideas inside each topic) and a plain list of ideas.
   */
  function showWhereYouStand() {
    const panel = findElement("where-you-stand");
    const labels = quiz.book.labels;
    const view = chosenView || currentView();
    const hasIdeas = quiz.learning.hasConcepts();
    panel.textContent = "";
    panel.appendChild(createElement("h2", null,
      view === "ideas" ? "Your ideas" : "Where you stand"));
    quiz.layout.makeFoldable(panel, "stand");
    panel.appendChild(createViewSwitch(view));
    const controls = createElement("div", "stand-controls");
    controls.appendChild(createElement("span", "stand-count",
      countWithWord(quiz.book.unitIds.length,
        labels.unit.toLowerCase(), labels.units)));
    controls.appendChild(quiz.layout.createExpandControls(panel));
    panel.appendChild(controls);
    if (view === "ideas" && !hasIdeas) {
      panel.appendChild(createElement("p", "empty-note",
        "This book has questions but no teaching ideas, so there is " +
        "nothing to list here. Switch to Chapter structure to see " +
        "your progress."));
      return;
    }
    const hasAnsweredAny =
      Object.keys(quiz.progress.saved.questions).length > 0;
    if (!hasAnsweredAny) {
      panel.appendChild(createElement("p", "empty-note",
        "Nothing yet. Start a session and your " + labels.units +
        " and topics will fill in here, with the weak ones marked."));
    }
    quiz.book.unitIds.forEach(function addUnit(unitId) {
      panel.appendChild(createUnitProgress(unitId, view));
    });
    panel.appendChild(createElement("p", "note",
      hasIdeas ? ideasNoteText() :
        "Solid means answered right several times with growing gaps. " +
        "Open a " + labels.unit.toLowerCase() + " to see its topics. " +
        "Topics in red are ones you have missed."));
  }

  /** @returns {string} what the idea statuses mean */
  function ideasNoteText() {
    return "Open any idea and start where you like: Teach me shows the " +
      "card first, Test me goes straight to the questions. " +
      "Understood means every question of the idea has been " +
      "answered right at least once. Solid means most of them have " +
      "been answered right several times with growing gaps. Open a " +
      quiz.book.labels.unit.toLowerCase() + " to see its ideas.";
  }

  /**
   * A chapter row (click to open) with its topics or ideas inside.
   * @param {string} unitId
   * @param {"structure"|"ideas"} view
   * @returns {HTMLElement}
   */
  function createUnitProgress(unitId, view) {
    const questions = quiz.book.questionsInUnit(unitId);
    const percentSolid = percentSolidOf(questions);
    const details = createElement("details", "unit-progress");
    const start = quiz.layout.chaptersStart();
    details.open = start === "open" ||
      (start === "next" && quiz.learning.hasConcepts() &&
        isNextUnit(unitId));
    const summary = createElement("summary");
    const name = createElement("div", "unit-name");
    name.appendChild(createElement("b", null, unitId));
    name.appendChild(createElement("span", null,
      quiz.book.unitTitles[unitId]));
    summary.appendChild(name);
    summary.appendChild(createProgressBar(percentSolid));
    summary.appendChild(createElement("div", "percent", percentSolid + "%"));
    details.appendChild(summary);
    const unitSummary = (quiz.book.data.unitSummaries || {})[unitId];
    if (unitSummary) {
      details.appendChild(createElement("p", "unit-summary", unitSummary));
    }
    details.appendChild(createUnitBody(unitId, questions, view));
    return details;
  }

  /**
   * What a chapter opens to: a flat list of ideas (ideas view), the
   * topics with their ideas inside (structure view of a book with
   * ideas), or just the topics (a book without ideas).
   * @param {string} unitId
   * @param {object[]} questions  the chapter's questions
   * @param {"structure"|"ideas"} view
   * @returns {HTMLElement}
   */
  function createUnitBody(unitId, questions, view) {
    if (!quiz.learning.hasConcepts()) {
      return createTopicList(questions);
    }
    return view === "ideas"
      ? createConceptList(unitId)
      : createStructureList(unitId, questions);
  }

  /**
   * The topics (book sub-headings) of a chapter, each opening to the
   * ideas that belong to it.
   * @param {string} unitId
   * @param {object[]} questions  the chapter's questions
   * @returns {HTMLElement}
   */
  function createStructureList(unitId, questions) {
    const list = createElement("div", "section-list");
    groupBySection(questions).forEach(function addSection(topic) {
      list.appendChild(createSectionRow(unitId, topic));
    });
    return list;
  }

  /**
   * One topic: name, missed count and progress; opens to its ideas.
   * @param {string} unitId
   * @param {{section: string, questions: object[]}} topic
   * @returns {HTMLElement}
   */
  function createSectionRow(unitId, topic) {
    const missCount = topic.questions.reduce(
      function addMisses(total, question) {
        return total + quiz.memory.timesMissed(question.id);
      }, 0);
    const percentSolid = percentSolidOf(topic.questions);
    const row = createElement("details", "section-row");
    row.open = quiz.layout.innerStartsOpen();
    const summary = createElement("summary");
    summary.appendChild(createElement("span",
      "section-name" + (missCount ? " is-weak" : ""),
      topic.section + (missCount ? " (missed " + missCount + "x)" : "")));
    summary.appendChild(createProgressBar(percentSolid));
    summary.appendChild(
      createElement("div", "percent", percentSolid + "%"));
    row.appendChild(summary);
    row.appendChild(createConceptList(unitId, topic.section));
    return row;
  }

  // ---------------------------------------------------------- concepts

  /**
   * True for the chapter that holds the next idea to learn, so it
   * starts open.
   * @param {string} unitId
   * @returns {boolean}
   */
  function isNextUnit(unitId) {
    const next = quiz.learning.conceptsToLearn(
      { unitId: "all", conceptCount: 1, onlyUnfinished: true })[0];
    return Boolean(next) && next.unit === unitId;
  }

  /**
   * The ideas of one chapter (or of one topic in it), each opening to
   * its card and a button.
   * @param {string} unitId
   * @param {string} [section]  keep only the ideas of this topic
   * @returns {HTMLElement}
   */
  function createConceptList(unitId, section) {
    const list = createElement("ul", "concept-list");
    quiz.learning.concepts()
      .filter(function inUnit(concept) {
        return concept.unit === unitId &&
          (section === undefined || concept.section === section);
      })
      .forEach(function addConcept(concept) {
        const item = createElement("li");
        item.appendChild(createConceptRow(concept));
        list.appendChild(item);
      });
    return list;
  }

  /**
   * One idea: title, status and progress; opens to the card and the
   * button that teaches or practises it.
   * @param {object} concept
   * @returns {HTMLElement}
   */
  function createConceptRow(concept) {
    const status = quiz.learning.statusOf(concept.id);
    const percentSolid =
      percentSolidOf(quiz.learning.questionsOf(concept.id));
    const row = createElement("details", "concept-row");
    row.open = quiz.layout.innerStartsOpen();
    row.dataset.conceptId = concept.id;
    const summary = createElement("summary");
    summary.appendChild(createElement("span", "concept-title",
      concept.title));
    if (concept.core === true) {
      summary.appendChild(createElement("span", "core-chip", "Core"));
    }
    summary.appendChild(createElement("span", "status-chip is-" + status,
      quiz.learning.statusName(status)));
    summary.appendChild(createProgressBar(percentSolid));
    summary.appendChild(createElement("div", "percent", percentSolid + "%"));
    if (concept.question) {
      summary.appendChild(createElement("span", "concept-guide",
        "Read to answer: " + concept.question));
    }
    row.appendChild(summary);

    const body = createElement("div", "concept-body");
    body.appendChild(quiz.learning.createCardContent(concept));
    const needs = quiz.learning.missingRequirementTitles(concept.id);
    if (needs.length && status !== "solid" && status !== "understood") {
      body.appendChild(createElement("p", "concept-needs",
        "Builds on: " + needs.join(", ") +
        ". You can still start here."));
    }
    appendWeakPart(body, concept);
    const flagBar = quiz.flags.createIdeaFlagBar(concept);
    if (flagBar) {
      body.appendChild(flagBar);
    }
    body.appendChild(createConceptActions(concept, status));
    row.appendChild(body);
    return row;
  }

  /**
   * Where this idea breaks down for the reader, with a button that
   * practises just that part. Nothing is shown until something is shaky.
   * @param {HTMLElement} body
   * @param {object} concept
   */
  function appendWeakPart(body, concept) {
    const weak = quiz.learning.weakPartOf(concept.id);
    if (!weak) {
      return;
    }
    const solidText = weak.solid.length ?
      "Solid on " + weak.solid.join(" and ") + ", but " : "";
    const line = createElement("p", "concept-weak",
      solidText + (solidText ? "shaky on " : "Shaky on ") + weak.shaky + ".");
    if (weak.buildsOn) {
      line.appendChild(document.createTextNode(" This idea builds on " +
        weak.buildsOn + ", which you have not started. Start there."));
    }
    body.appendChild(line);
    body.appendChild(quiz.helpers.createButton("Practise the weak part",
      "button", function practiseWeakPart() {
        quiz.session.startQuestions(weak.questions,
          "Weak part: " + concept.title);
      }));
  }

  /**
   * The buttons under a concept's card: "Teach me" (pretest, card,
   * ladder; just the open questions once the idea has been started)
   * and "Test me" (the ladder questions, no card).
   * @param {object} concept
   * @param {string} status
   * @returns {HTMLElement}
   */
  function createConceptActions(concept, status) {
    const actions = createElement("div", "concept-actions button-row");
    const isNew = status === "new";
    actions.appendChild(quiz.helpers.createButton(
      isNew ? "Teach me" : "Teach me again",
      isNew ? "button primary" : "button",
      function teachConcept() {
        quiz.session.startLearning([concept.id]);
      }));
    actions.appendChild(quiz.helpers.createButton("Test me",
      isNew ? "button" : "button primary", function testConcept() {
        quiz.session.startQuestions(quiz.learning.ladderOf(concept.id),
          "Test: " + concept.title);
      }));
    return actions;
  }

  /**
   * One row per topic in a chapter, weak topics in red.
   * @param {object[]} questions  the chapter's questions
   * @returns {HTMLElement}
   */
  function createTopicList(questions) {
    const list = createElement("ul", "topic-list");
    groupBySection(questions).forEach(function addTopic(topic) {
      const missCount = topic.questions.reduce(
        function addMisses(total, question) {
          return total + quiz.memory.timesMissed(question.id);
        }, 0);
      const percentSolid = percentSolidOf(topic.questions);
      const item = createElement("li");
      const missedNote = missCount ? " (missed " + missCount + "x)" : "";
      item.appendChild(createElement("span", missCount ? "is-weak" : null,
        topic.section + missedNote));
      item.appendChild(createProgressBar(percentSolid));
      item.appendChild(
        createElement("div", "percent", percentSolid + "%"));
      list.appendChild(item);
    });
    return list;
  }

  /**
   * Group questions by their "section" (topic), keeping book order.
   * @param {object[]} questions
   * @returns {{section: string, questions: object[]}[]}
   */
  function groupBySection(questions) {
    const topics = [];
    questions.forEach(function addToTopic(question) {
      let topic = topics.find(function sameSection(existing) {
        return existing.section === question.section;
      });
      if (!topic) {
        topic = { section: question.section, questions: [] };
        topics.push(topic);
      }
      topic.questions.push(question);
    });
    return topics;
  }

  /**
   * How much of a set of questions is solid.
   * @param {object[]} questions
   * @returns {number}  whole percent of questions that are solid
   */
  function percentSolidOf(questions) {
    const solidCount = countWhere(questions, quiz.memory.isSolid);
    return Math.round((100 * solidCount) / questions.length);
  }

  /**
   * A thin bar filled to a percentage.
   * @param {number} percent
   * @returns {HTMLElement}
   */
  function createProgressBar(percent) {
    const bar = createElement("div", "progress-bar");
    const fill = createElement("i");
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    return bar;
  }

  function redrawLayout() {
    if (quiz.book.data) {
      showWhereYouStand();
      showRecentResults();
      }
  }
  document.addEventListener("recallquiz:layout-applied", redrawLayout);
  document.addEventListener("recallquiz:practice-changed", function redo() {
    if (quiz.book.data) {
      }
  });

  /** The ideas that were hidden the last time the home screen was drawn */
  let hiddenIdeaKey = "";

  /** @returns {string} the ids of the hidden ideas, as one text */
  function readHiddenIdeaKey() {
    return quiz.bookSettings.listFlaggedIdeas()
      .filter(function isHidden(entry) {
        return quiz.bookSettings.isIdeaHidden(entry.id);
      })
      .map(function idOf(entry) {
        return entry.id;
      }).sort().join("|");
  }

  /**
   * An idea was flagged. Only an idea that appears or disappears needs a
   * redraw (so an open idea does not fold shut while it is flagged
   * Revisit or Important).
   */
  function ideaFlagsChanged() {
    const key = readHiddenIdeaKey();
    if (!quiz.book.data || key === hiddenIdeaKey) {
      return;
    }
    hiddenIdeaKey = key;
    showBookDetails();
    refresh();
  }

  /** The book was opened or settings arrived: draw the ideas again. */
  function ideasMayHaveChanged() {
    hiddenIdeaKey = readHiddenIdeaKey();
    if (quiz.book.data) {
      showBookDetails();
      refresh();
    }
  }
  document.addEventListener("recallquiz:book-opened", function noteHidden() {
    hiddenIdeaKey = readHiddenIdeaKey();
  });
  document.addEventListener("recallquiz:idea-flags-changed",
    ideaFlagsChanged);
  document.addEventListener("recallquiz:book-settings-applied",
    ideasMayHaveChanged);

  quiz.homeScreen = { showBookDetails, refresh };
})((window.RecallQuiz = window.RecallQuiz || {}));
