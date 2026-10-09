/*
 * session.js
 * Runs a practice session: picks the questions, shows them one at a
 * time, and hands over to the results screen at the end.
 *
 * Each question type draws into a "card" object (see
 * createQuestionCard below). That object is the only thing a question
 * type needs to know about the session.
 */
(function setUpSession(quiz) {
  "use strict";

  const { findElement, createElement, createButton } = quiz.helpers;

  /** Everything about the session in progress */
  const state = {
    /** The questions for this session, in the order they are asked */
    questions: [],
    /** Index of the question on screen */
    currentIndex: 0,
    /** How many answers were right, partly right and missed */
    score: { got: 0, part: 0, miss: 0 },
    /** Questions missed this session, for the results screen */
    missedQuestions: [],
    /** Questions answered right this session ("what went right") */
    rightQuestions: [],
    /** Times the reader said "Certain" and was wrong */
    confidentMissCount: 0,
    /** Warm-up guesses (pretests) answered. They are not scored. */
    pretestCount: 0,

    /** True for a Learn session (pretests, cards, ladders) */
    isGuided: false,
    /** Titles of the concepts a Learn session teaches */
    conceptTitles: [],
    /** What this session is called in "Your recent results" */
    scopeName: "",

    /** Settings copied when the session starts */
    isTimed: false,
    sessionMinutes: 0,
    secondsPerQuestion: 0,
    askConfidence: false,

    /** True once the current question has been answered */
    currentQuestionAnswered: false,
    /** Set when the session clock ran out while feedback was showing */
    timeRanOut: false,
    /** The confidence level picked for this question (1 to 3) */
    confidenceLevel: null,
    /** True while the answer area waits for a confidence level */
    isAnswerAreaLocked: false,
    /** What the keyboard does on this question (set by question types) */
    keyHandler: null,
  };

  // ---------------------------------------------------------- start

  /**
   * Start a session. Without a plan it uses the settings on the home
   * screen. A plan starts exactly its steps (the concept list buttons
   * use this).
   * @param {{questions: object[], isGuided: boolean, isTimed: boolean,
   *          conceptTitles: string[], scopeName: string}} [plan]
   */
  function startSession(plan) {
    const chosen = plan || quiz.settings.chooseSession();
    if (chosen.questions.length === 0) {
      quiz.settings.updateReadySummary();
      return;
    }
    resetState(chosen);
    quiz.timers.stopSessionClock();
    document.body.classList.add("in-session");
    if (state.isTimed) {
      quiz.timers.startSessionClock(state.sessionMinutes, onSessionTimeUp);
    }
    findElement("home-screen").classList.add("hidden");
    findElement("where-you-stand").classList.add("hidden");
    // The Start button is now hidden but may still have keyboard focus,
    // which would swallow the first Enter. Let the page have it instead.
    document.activeElement.blur();
    showCurrentQuestion();
  }

  /** Start a Learn session for chosen concepts (from the concept list). */
  function startLearning(conceptIds) {
    startSession(quiz.learning.createLearnPlan({ conceptIds }));
  }

  /**
   * Practise exactly these questions, shuffled (from the concept list).
   * @param {object[]} questions
   * @param {string} scopeName
   */
  function startQuestions(questions, scopeName) {
    startSession({
      questions: quiz.helpers.shuffledCopy(questions),
      isGuided: false,
      isTimed: false,
      conceptTitles: [],
      scopeName,
    });
  }

  /**
   * Fresh state for a new session.
   * @param {{questions: object[], isGuided: boolean, isTimed: boolean,
   *          conceptTitles: string[], scopeName: string}} plan
   */
  function resetState(plan) {
    const settings = quiz.settings.current;
    state.questions = plan.questions;
    state.currentIndex = 0;
    state.score = { got: 0, part: 0, miss: 0 };
    state.missedQuestions = [];
    state.rightQuestions = [];
    state.confidentMissCount = 0;
    state.pretestCount = 0;
    state.isGuided = Boolean(plan.isGuided);
    state.conceptTitles = plan.conceptTitles || [];
    state.scopeName = plan.scopeName || quiz.settings.scopeName();
    state.isTimed = Boolean(plan.isTimed);
    state.sessionMinutes = quiz.settings.sessionMinutes();
    state.secondsPerQuestion = settings.secondsPerQuestion;
    state.askConfidence = settings.askConfidence;
    state.timeRanOut = false;
  }

  /**
   * The session clock ran out. If the reader is looking at feedback,
   * let them finish reading; the results come after "Next".
   */
  function onSessionTimeUp() {
    if (state.currentQuestionAnswered) {
      state.timeRanOut = true;
    } else {
      quiz.resultsScreen.showResults();
    }
  }

  // ---------------------------------------------------------- questions

  /** Show the question at state.currentIndex, or the results. */
  function showCurrentQuestion() {
    if (state.currentIndex >= state.questions.length) {
      quiz.resultsScreen.showResults();
      return;
    }
    quiz.timers.stopQuestionTimer();
    state.currentQuestionAnswered = false;
    const question = state.questions[state.currentIndex];
    const isCard = question.kind === "lesson";
    const cardElement = openQuestionCard();

    cardElement.appendChild(state.isTimed
      ? quiz.timers.createSessionClockBar(state.currentIndex + 1)
      : createProgressSegments());
    if (state.secondsPerQuestion && !isCard) {
      cardElement.appendChild(
        quiz.timers.createQuestionTimer(state.secondsPerQuestion));
    }
    cardElement.appendChild(createQuestionMeta(question));
    cardElement.appendChild(createQuestionText(question));
    if (question.hint) {
      cardElement.appendChild(createHintRow(question.hint));
    }
    const ideaRow = isCard ? null : createShowIdeaRow(question);
    if (ideaRow) {
      cardElement.appendChild(ideaRow);
    }
    if (!state.isTimed) {
      quiz.timers.showQuestionsLeft(
        countQuestionsFrom(state.currentIndex), countQuestionsFrom(0));
    }

    const answerArea = createElement("div");
    // Cards have nothing to answer, and a warm-up guess is meant to be
    // a guess, so neither asks "How sure are you?".
    const asksConfidence = state.askConfidence && !isCard &&
      !question.isPretestRun;
    if (asksConfidence) {
      cardElement.appendChild(
        quiz.answerFeedback.createConfidenceRow(answerArea));
    } else {
      state.confidenceLevel = null;
      state.isAnswerAreaLocked = false;
    }
    cardElement.appendChild(answerArea);
    const keyHint = createElement("p", "key-hint");
    cardElement.appendChild(keyHint);

    state.keyHandler = null;
    const card = createQuestionCard(question, answerArea, keyHint);
    quiz.questionTypes.show(question, card);
    cardElement.appendChild(createEndSessionButton());
    // Optional add-ons (such as the HTRAB overlay) decorate the question.
    document.dispatchEvent(new CustomEvent("recallquiz:question-shown",
      { detail: { question, cardElement } }));
  }

  /**
   * How many steps to answer from an index on (cards do not count).
   * @param {number} startIndex
   * @returns {number}
   */
  function countQuestionsFrom(startIndex) {
    return state.questions.slice(startIndex).filter(
      function isQuestion(step) {
        return step.kind !== "lesson";
      }).length;
  }

  /**
   * A "Show a hint" button that reveals the question's hint.
   * @param {string} hintText
   * @returns {HTMLElement}
   */
  function createHintRow(hintText) {
    const row = createElement("div", "hint-row");
    const button = createButton("Show a hint", "pill-button",
      function showHint() {
        button.remove();
        row.appendChild(createElement("p", "hint-text", hintText));
      });
    row.appendChild(button);
    return row;
  }

  /**
   * A "Read the idea" panel that opens the concept card above the
   * question, so the reader can read first, answer later. Not offered
   * on a warm-up guess, which is meant to come before the card.
   * @param {object} question
   * @returns {HTMLElement|null}
   */
  function createShowIdeaRow(question) {
    const concept = quiz.learning.conceptById(question.concept);
    if (!concept || question.isPretestRun) {
      return null;
    }
    const row = createElement("div", "hint-row");
    row.appendChild(quiz.learning.createIdeaAgainPanel(concept, false, true));
    return row;
  }

  /** Move on: the next question, or the results if time ran out. */
  function goToNextQuestion() {
    if (state.timeRanOut) {
      quiz.resultsScreen.showResults();
      return;
    }
    state.currentIndex += 1;
    showCurrentQuestion();
  }

  /**
   * Everything a question type can use. Question types get only this
   * object, so they stay independent of how the session works.
   * @param {object} question
   * @param {HTMLElement} answerArea  where the type draws its controls
   * @param {HTMLElement} keyHintElement  the "Keys: ..." line
   * @returns {object}
   */
  function createQuestionCard(question, answerArea, keyHintElement) {
    return {
      /** Where the question type draws its buttons and boxes */
      answerArea,

      /** @param {string} text  e.g. "Keys: 1 to 4 to answer" */
      setKeyHint(text) {
        keyHintElement.textContent = text;
      },

      /** @param {Function|null} handler  receives each keydown event */
      setKeyHandler(handler) {
        state.keyHandler = handler;
      },

      /** @param {Function} handler  called when the question timer ends */
      setTimeUpHandler(handler) {
        quiz.timers.setQuestionTimeUpHandler(handler);
      },

      /** Stop the question timer early (e.g. while the reader rates). */
      stopTimer() {
        quiz.timers.stopQuestionTimer();
      },

      /** @returns {boolean} true until a confidence level is picked */
      isWaitingForConfidence() {
        return state.isAnswerAreaLocked;
      },

      /**
       * The reader has answered: record it and show the feedback.
       * @param {"got"|"part"|"miss"} result
       * @param {{timedOut?: boolean, extraContent?: HTMLElement}} [options]
       */
      showResult(result, options) {
        quiz.answerFeedback.showAnswerFeedback(question, this, result,
          options);
      },

      /**
       * Record a self-rating and go straight on (used by recall, which
       * has already shown the answer).
       * @param {"got"|"part"|"miss"} result
       */
      saveSelfRating(result) {
        quiz.answerFeedback.recordResult(question, result);
        goToNextQuestion();
      },

      /** Move on from a step with nothing to answer (a concept card). */
      continueToNext() {
        state.currentQuestionAnswered = true;
        goToNextQuestion();
      },
    };
  }

  // ---------------------------------------------------------- drawing

  /** @returns {HTMLElement} the empty question card, scrolled to top */
  function openQuestionCard() {
    const cardElement = findElement("question-card");
    cardElement.classList.remove("hidden");
    cardElement.textContent = "";
    window.scrollTo({ top: 0 });
    return cardElement;
  }

  /** @returns {HTMLElement} one segment per question in the session */
  function createProgressSegments() {
    const progress = createElement("div", "question-progress");
    state.questions.forEach(function addSegment(question, index) {
      let className = "";
      if (index < state.currentIndex) {
        className = "is-done";
      } else if (index === state.currentIndex) {
        className = "is-current";
      }
      progress.appendChild(createElement("i", className));
    });
    return progress;
  }

  /**
   * Chapter, topic and question type above the question.
   * @param {object} question
   * @returns {HTMLElement}
   */
  function createQuestionMeta(question) {
    const meta = createElement("div", "question-meta");
    const heading = createElement("div", "unit-heading");
    heading.appendChild(createElement("span", "unit-chip",
      quiz.book.unitShortName(question)));
    if (question.unitTitle) {
      heading.appendChild(
        createElement("span", "unit-title", question.unitTitle));
    }
    meta.appendChild(heading);

    const topic = createElement("div", "topic-line");
    topic.appendChild(
      document.createTextNode(quiz.book.labels.topic + ": "));
    topic.appendChild(createElement("mark", null, question.section));
    meta.appendChild(topic);

    meta.appendChild(createElement("span", "question-kind",
      quiz.learning.stepLabel(question,
        quiz.questionTypes.labelFor(question))));
    return meta;
  }

  /**
   * The question itself, with its highlighter stripe.
   * @param {object} question
   * @returns {HTMLElement}
   */
  function createQuestionText(question) {
    const wrap = createElement("div", "question-wrap");
    wrap.appendChild(createElement("span", "question-text", question.q));
    return wrap;
  }

  /** @returns {HTMLButtonElement} "End session", back to the home screen */
  function createEndSessionButton() {
    return createButton("End session", "button end-session-button",
      function endSession() {
        // Only ask before throwing away a session on its first question.
        const isPastFirstQuestion = state.currentIndex > 0;
        if (isPastFirstQuestion || confirm("Leave this session?")) {
          state.keyHandler = null;
          returnHome();
        }
      });
  }

  // ---------------------------------------------------------- leaving

  /** Stop everything and go back to the home screen. */
  function returnHome() {
    document.body.classList.remove("in-session");
    quiz.timers.stopSessionClock();
    quiz.timers.stopQuestionTimer();
    state.keyHandler = null;
    findElement("question-card").classList.add("hidden");
    findElement("home-screen").classList.remove("hidden");
    findElement("where-you-stand").classList.remove("hidden");
    quiz.homeScreen.refresh();
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------- keyboard

  /**
   * Send key presses to the current question type.
   * @param {KeyboardEvent} event
   */
  function handleKeyPress(event) {
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (!state.keyHandler || state.isAnswerAreaLocked || hasModifier) {
      return;
    }
    const isEnterOrSpace = event.key === "Enter" || event.key === " ";
    // A focused button already acts on Enter and Space by itself.
    if (isEnterOrSpace && event.target.tagName === "BUTTON") {
      return;
    }
    // Without this, the same key press would also "click" any button
    // that receives focus while the handler runs (such as Next).
    if (isEnterOrSpace) {
      event.preventDefault();
    }
    state.keyHandler(event);
  }

  findElement("start-button").addEventListener("click",
    function startFromSettings() {
      startSession();
    });
  findElement("keep-going-button").addEventListener("click",
    function startKeepGoing() {
      startSession(quiz.settings.chooseKeepGoing());
    });
  findElement("quick-session-button").addEventListener("click",
    function startQuickSession() {
      startSession(quiz.settings.chooseQuickSession());
    });
  document.addEventListener("keydown", handleKeyPress);

  quiz.session = {
    state,
    startSession,
    startLearning,
    startQuestions,
    goToNextQuestion,
    returnHome,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
