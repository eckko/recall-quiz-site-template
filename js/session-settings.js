/*
 * session-settings.js
 * The "What do you want to practise?" panel: Learn or Review, which
 * chapter, which questions, how long, the optional timer and confidence
 * check. Works out which questions a session will use and says how many
 * are ready.
 *
 * "Keep me going" picks the next steps for the reader: due reviews,
 * then the next idea to teach. "Custom practice" is the old practice
 * session with its filters.
 */
(function setUpSessionSettings(quiz) {
  "use strict";

  const { findElement, shuffledCopy, readWholeNumber, countWithWord } =
    quiz.helpers;

  const DEFAULT_SESSION_MINUTES = 15;

  /** The current choices. Changed by the buttons on the panel. */
  const current = {
    /** "all" (everything), "due" (due and new), "gaps" (missed and
        still weak) or "important" (flagged Important) */
    questionFilter: "all",
    /** "questions" (a number of questions) or "time" (minutes) */
    lengthMode: "questions",
    /** 0 for no timer, otherwise 15, 30 or 60 */
    secondsPerQuestion: 0,
    /** Ask "How sure are you?" before each answer (on by default:
        confident wrong answers are the ones that teach the most) */
    askConfidence: true,
  };

  // ---------------------------------------------------------- questions

  /** @returns {{unit: string, section?: string, concept?: string}}
      the lesson picked: a chapter, a topic in it, or an idea in that */
  function chosenScope() {
    return quiz.scopePicker.read();
  }

  /** @returns {string} e.g. "Whole book", "Chapter 9" or an idea's title,
      for history */
  function scopeName() {
    return quiz.scopePicker.scopeName(chosenScope());
  }

  /** @returns {object[]} the Review questions that match the choices */
  function questionsMatchingSettings() {
    const scope = chosenScope();
    return quiz.book.allQuestions().filter(function matches(question) {
      return quiz.book.matchesScope(question, scope) &&
        passesQuestionFilter(question);
    });
  }

  /**
   * True if a question fits "Due and new", "My gaps", "Important only" or
   * "Everything". Questions of ideas that have not been taught yet are
   * left out of Due and My gaps; Everything and Important include them.
   * @param {object} question
   * @returns {boolean}
   */
  function passesQuestionFilter(question) {
    if (current.questionFilter === "all") {
      return true;
    }
    if (current.questionFilter === "important") {
      return quiz.bookSettings.hasFlag(question.id, "important");
    }
    if (!quiz.learning.isAvailableForReview(question)) {
      return false;
    }
    if (current.questionFilter === "due") {
      return quiz.memory.isDueOrNew(question.id);
    }
    return quiz.memory.isGap(question.id);
  }

  /** @returns {number} questions asked for; 0 means all of them */
  function chosenQuestionCount() {
    return readWholeNumber("question-count-input", 0);
  }

  /** @returns {number} minutes for a timed session (at least 1) */
  function sessionMinutes() {
    return Math.max(1,
      readWholeNumber("minutes-input", DEFAULT_SESSION_MINUTES));
  }

  /**
   * The custom practice plan for the current choices (see
   * js/session.js).
   * @returns {{questions: object[], isGuided: boolean, isTimed: boolean,
   *            conceptTitles: string[], scopeName: string}}
   */
  function chooseSession() {
    let questions = shuffledCopy(questionsMatchingSettings());
    const count = chosenQuestionCount();
    if (current.lengthMode === "questions" && count) {
      questions = questions.slice(0, count);
    }
    return {
      questions,
      isGuided: false,
      isTimed: current.lengthMode === "time",
      conceptTitles: [],
      scopeName: scopeName(),
    };
  }

  /** @returns {object} the 5-minute plan: core ideas only */
  function chooseQuickSession() {
    return quiz.learning.createQuickPlan({ scope: chosenScope() });
  }

  /** @returns {object} the "Keep me going" plan for the chosen lesson */
  function chooseKeepGoing() {
    return quiz.learning.createKeepGoingPlan({ scope: chosenScope() });
  }

  // ---------------------------------------------------------- summary

  /** The lines under the two start buttons. */
  function updateReadySummary() {
    findElement("ready-summary").textContent = readySummaryText();
    if (quiz.layout.isShown("keepGoing")) {
      updateKeepGoingSummary();
    }
  }

  /**
   * Write the "Up next" line. Working it out plans a whole session, which
   * takes a moment in a big book, so it is skipped while Keep me going is
   * hidden and done when the reader shows it (js/home-layout.js).
   */
  function updateKeepGoingSummary() {
    findElement("keep-going-summary").textContent = keepGoingSummaryText();
  }

  /** @returns {string} what "Keep me going" would do next */
  function keepGoingSummaryText() {
    const plan = chooseKeepGoing();
    if (plan.questions.length === 0) {
      return "No questions in this lesson yet.";
    }
    const titles = plan.conceptTitles.join(" and ");
    const reviews = countWithWord(plan.reviewCount, "due question");
    if (plan.fallback === "gaps") {
      return "Nothing due. Up next: " +
        countWithWord(plan.questions.length, "question") +
        " you found hard.";
    }
    if (plan.fallback === "mix") {
      return "Nothing due and nothing new here. Up next: a mixed set of " +
        countWithWord(plan.questions.length, "question") + ".";
    }
    if (!titles) {
      return "Up next: review " + reviews + ". Nothing new to learn here.";
    }
    const learn = "learn " + titles + " (a quick guess, a short card, " +
      countWithWord(quiz.learning.countScoredSteps(plan.questions) -
        plan.reviewCount, "question") + ")";
    return plan.reviewCount ?
      "Up next: review " + reviews + ", then " + learn + "." :
      "Up next: " + learn + ".";
  }

  /** @returns {string} */
  function readySummaryText() {
    const readyCount = questionsMatchingSettings().length;
    if (readyCount === 0) {
      return nothingReadyText();
    }
    const questionsAre = readyCount === 1
      ? "1 question is"
      : readyCount + " questions are";
    if (current.lengthMode === "time") {
      return questionsAre + " ready. The session ends after " +
        countWithWord(sessionMinutes(), "minute") +
        " or when you run out of questions.";
    }
    const count = chosenQuestionCount();
    if (count) {
      return "Up to " + Math.min(count, readyCount) + " of " + readyCount +
        " ready questions will be asked.";
    }
    return questionsAre + " ready with these settings.";
  }

  /** @returns {string} why nothing is ready, and what to try */
  function nothingReadyText() {
    if (current.questionFilter === "gaps") {
      return "No gaps yet. Answer a few questions and any you miss " +
        "will appear here.";
    }
    if (current.questionFilter === "important") {
      return "No questions are flagged Important here yet. Flag a " +
        "question while you practise and it will appear here.";
    }
    if (current.questionFilter === "due") {
      return quiz.learning.hasConcepts() ?
        "Nothing is due here right now. Try Keep me going to learn " +
        "something new, or Everything to practise ahead." :
        "Nothing is due here right now. Try Everything to " +
        "practise ahead.";
    }
    return "No questions in this lesson yet.";
  }

  // ---------------------------------------------------------- controls

  /**
   * Make a row of buttons behave like radio buttons.
   * @param {string} groupId
   * @param {function(string): void} onChoose  gets the data-value
   */
  function setUpChoiceGroup(groupId, onChoose) {
    const group = findElement(groupId);
    group.addEventListener("click", function chooseButton(event) {
      const chosen = event.target.closest("button");
      if (!chosen) {
        return;
      }
      Array.from(group.children).forEach(function markPressedButton(button) {
        button.setAttribute("aria-pressed", String(button === chosen));
      });
      onChoose(chosen.getAttribute("data-value"));
      updateReadySummary();
      notifyPracticeChanged(groupId);
    });
  }

  /**
   * Tell the page that a choice kept with the reader's settings changed
   * (the timer, the confidence check or the lesson). The custom
   * practice choices are for one session and are not announced.
   * @param {string} groupId
   */
  function notifyPracticeChanged(groupId) {
    if (groupId === "question-timer-choice" ||
        groupId === "confidence-choice" || groupId === "lesson") {
      document.dispatchEvent(new CustomEvent("recallquiz:practice-changed"));
    }
  }

  /** Press the button of a group that has this data-value. */
  function markGroup(groupId, value) {
    Array.from(findElement(groupId).children).forEach(
      function mark(button) {
        button.setAttribute("aria-pressed",
          String(button.getAttribute("data-value") === value));
      });
  }

  /** @returns {{timer: number, confidence: boolean, scope: object}} */
  function readChoices() {
    return {
      timer: current.secondsPerQuestion,
      confidence: current.askConfidence,
      scope: chosenScope(),
    };
  }

  /**
   * Use saved choices (from this browser or the account). Values that do
   * not fit this book (a chapter it does not have) are ignored.
   * @param {{timer?: number, confidence?: boolean, scope?: object,
   *          filter?: string, lengthMode?: string, count?: number,
   *          minutes?: number}} wanted
   */
  function useChoices(wanted) {
    if ([0, 15, 30, 60].indexOf(wanted.timer) >= 0) {
      current.secondsPerQuestion = wanted.timer;
      markGroup("question-timer-choice", String(wanted.timer));
    }
    if (typeof wanted.confidence === "boolean") {
      current.askConfidence = wanted.confidence;
      markGroup("confidence-choice", wanted.confidence ? "on" : "off");
    }
    if (wanted.scope) {
      quiz.scopePicker.write(wanted.scope);
    }
    useCustomPracticeChoices(wanted);
    updateReadySummary();
  }

  /**
   * Use the Custom practice defaults that are present.
   * @param {{filter?: string, lengthMode?: string, count?: number,
   *          minutes?: number}} wanted
   */
  function useCustomPracticeChoices(wanted) {
    if (wanted.filter) {
      current.questionFilter = wanted.filter;
      markGroup("question-filter-choice", wanted.filter);
    }
    if (wanted.lengthMode) {
      current.lengthMode = wanted.lengthMode;
      markGroup("session-length-choice", wanted.lengthMode);
      showLengthRowFor(wanted.lengthMode);
    }
    if (typeof wanted.count === "number") {
      findElement("question-count-input").value =
        wanted.count ? String(wanted.count) : "";
    }
    if (typeof wanted.minutes === "number") {
      findElement("minutes-input").value = String(wanted.minutes);
    }
  }

  /** Quick-pick buttons (5, 10, 25 ...) fill in their input box. */
  function setUpQuickPickButtons() {
    document.querySelectorAll("[data-fills]").forEach(
      function setUpQuickPick(button) {
        button.addEventListener("click", function fillInput() {
          const input = findElement(button.getAttribute("data-fills"));
          input.value = button.getAttribute("data-fill-value");
          updateReadySummary();
        });
      });
  }

  /** Show the number box for the chosen session length. */
  function showLengthRowFor(lengthMode) {
    findElement("length-by-questions")
      .classList.toggle("hidden", lengthMode !== "questions");
    findElement("length-by-time")
      .classList.toggle("hidden", lengthMode !== "time");
  }

  setUpChoiceGroup("question-filter-choice", function setFilter(value) {
    current.questionFilter = value;
  });
  setUpChoiceGroup("session-length-choice", function setLength(value) {
    current.lengthMode = value;
    showLengthRowFor(value);
  });
  setUpChoiceGroup("question-timer-choice", function setTimer(value) {
    current.secondsPerQuestion = parseInt(value, 10);
  });
  setUpChoiceGroup("confidence-choice", function setConfidence(value) {
    current.askConfidence = value === "on";
  });
  setUpQuickPickButtons();
  ["question-count-input", "minutes-input"].forEach(function watch(id) {
    findElement(id).addEventListener("input", updateReadySummary);
  });
  quiz.scopePicker.onChange(function onLessonChange() {
    updateReadySummary();
    notifyPracticeChanged("lesson");
  });

  quiz.settings = {
    current,
    scopeName,
    sessionMinutes,
    chooseSession,
    chooseKeepGoing,
    chooseQuickSession,
    updateReadySummary,
    updateKeepGoingSummary,
    readChoices,
    useChoices,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
