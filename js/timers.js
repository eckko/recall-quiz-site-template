/*
 * timers.js
 * The two optional countdowns:
 *
 *   Question timer  15, 30 or 60 seconds for each question. When it runs
 *                   out, the question type's time-up handler is called.
 *   Session clock   a whole session of N minutes. It shows in the pill in
 *                   the top right and as a bar on the question card.
 *
 * The pill also shows "Questions left 3/10" in sessions that are not
 * timed (see showQuestionsLeft).
 */
(function setUpTimers(quiz) {
  "use strict";

  const { findElement, createElement } = quiz.helpers;

  const QUESTION_TIMER_TICK_MS = 100;
  const SESSION_CLOCK_TICK_MS = 250;

  const questionTimer = {
    intervalId: null,
    endsAt: 0,
    totalSeconds: 0,
    /** Called once when the time runs out */
    onTimeUp: null,
  };

  const sessionClock = {
    intervalId: null,
    endsAt: 0,
    totalMinutes: 0,
    onTimeUp: null,
    /** The bar on the current question card, if one is showing */
    cardBar: null,
  };

  // ---------------------------------------------------------- question

  /**
   * Start the countdown for one question and return its bar.
   * @param {number} seconds
   * @returns {HTMLElement}  the timer element to put on the card
   */
  function createQuestionTimer(seconds) {
    const timerElement = createElement("div", "question-timer");
    const bar = createElement("div", "countdown-bar");
    const fill = createElement("i");
    const number = createElement("div", "countdown-number");
    bar.appendChild(fill);
    timerElement.appendChild(bar);
    timerElement.appendChild(number);

    questionTimer.totalSeconds = seconds;
    questionTimer.endsAt = Date.now() + seconds * 1000;

    /** Redraw the bar and number; call the time-up handler at zero. */
    function updateQuestionTimer() {
      const millisecondsLeft = Math.max(0, questionTimer.endsAt - Date.now());
      const secondsLeft = Math.ceil(millisecondsLeft / 1000);
      const fractionLeft = millisecondsLeft / (seconds * 1000);
      fill.style.width = 100 * fractionLeft + "%";
      number.textContent = secondsLeft + "s";
      timerElement.className =
        "question-timer" + questionTimerWarningClass(secondsLeft);
      if (millisecondsLeft <= 0) {
        const timeUpHandler = questionTimer.onTimeUp;
        stopQuestionTimer();
        if (timeUpHandler) {
          timeUpHandler();
        }
      }
    }

    questionTimer.intervalId = setInterval(
      updateQuestionTimer, QUESTION_TIMER_TICK_MS);
    updateQuestionTimer();
    return timerElement;
  }

  /**
   * Orange under 10 seconds, red under 5.
   * @param {number} secondsLeft
   * @returns {string}
   */
  function questionTimerWarningClass(secondsLeft) {
    if (secondsLeft <= 5) {
      return " is-critical";
    }
    if (secondsLeft <= 10) {
      return " is-low";
    }
    return "";
  }

  /**
   * Say what should happen when the question timer runs out.
   * @param {Function} handler
   */
  function setQuestionTimeUpHandler(handler) {
    questionTimer.onTimeUp = handler;
  }

  /** Stop the question countdown (the answer is in, or we moved on). */
  function stopQuestionTimer() {
    if (questionTimer.intervalId) {
      clearInterval(questionTimer.intervalId);
      questionTimer.intervalId = null;
    }
    questionTimer.onTimeUp = null;
  }

  // ---------------------------------------------------------- session

  /**
   * Start a timed session.
   * @param {number} minutes
   * @param {Function} onTimeUp  called once when the time runs out
   */
  function startSessionClock(minutes, onTimeUp) {
    sessionClock.totalMinutes = minutes;
    sessionClock.endsAt = Date.now() + minutes * 60 * 1000;
    sessionClock.onTimeUp = onTimeUp;
    sessionPill().classList.remove("hidden");
    sessionClock.intervalId = setInterval(
      updateSessionClock, SESSION_CLOCK_TICK_MS);
  }

  /** Stop the session clock and hide the pill. */
  function stopSessionClock() {
    if (sessionClock.intervalId) {
      clearInterval(sessionClock.intervalId);
      sessionClock.intervalId = null;
    }
    sessionClock.cardBar = null;
    sessionPill().classList.add("hidden");
  }

  /**
   * The bar shown at the top of the card in a timed session, in place of
   * the per-question progress segments.
   * @param {number} questionNumber  1 for the first question
   * @returns {HTMLElement}
   */
  function createSessionClockBar(questionNumber) {
    const clockElement = createElement("div", "session-clock");
    const row = createElement("div", "session-clock-row");
    const bar = createElement("div", "countdown-bar");
    const fill = createElement("i");
    row.appendChild(createElement("span", null, "Question " + questionNumber));
    bar.appendChild(fill);
    clockElement.appendChild(row);
    clockElement.appendChild(bar);
    sessionClock.cardBar = { clockElement, fill };
    updateSessionClock();
    return clockElement;
  }

  /** Redraw the pill and the card bar; end the session at zero. */
  function updateSessionClock() {
    const millisecondsLeft = Math.max(0, sessionClock.endsAt - Date.now());
    const secondsLeft = Math.ceil(millisecondsLeft / 1000);
    const warningClass = sessionClockWarningClass(secondsLeft);
    const isRunning = Boolean(sessionClock.intervalId);

    findElement("session-pill-label").textContent = "Time left";
    findElement("session-pill-value").textContent =
      formatMinutesAndSeconds(secondsLeft);
    sessionPill().className =
      "session-pill" + warningClass + (isRunning ? "" : " hidden");

    if (sessionClock.cardBar) {
      const totalMilliseconds = sessionClock.totalMinutes * 60 * 1000;
      const percentLeft = (100 * millisecondsLeft) / totalMilliseconds;
      sessionClock.cardBar.fill.style.width = percentLeft + "%";
      sessionClock.cardBar.clockElement.className =
        "session-clock" + warningClass;
    }

    if (millisecondsLeft <= 0) {
      const timeUpHandler = sessionClock.onTimeUp;
      stopSessionClock();
      stopQuestionTimer();
      if (timeUpHandler) {
        timeUpHandler();
      }
    }
  }

  /**
   * Orange in the last minute, red in the last 15 seconds.
   * @param {number} secondsLeft
   * @returns {string}
   */
  function sessionClockWarningClass(secondsLeft) {
    let warningClass = "";
    if (secondsLeft <= 60) {
      warningClass += " is-low";
    }
    if (secondsLeft <= 15) {
      warningClass += " is-critical";
    }
    return warningClass;
  }

  /**
   * Write seconds as minutes and seconds.
   * @param {number} totalSeconds
   * @returns {string}  e.g. "4:07"
   */
  function formatMinutesAndSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return minutes + ":" + seconds;
  }

  /**
   * In sessions that are not timed, the pill counts questions instead.
   * @param {number} questionsLeft  including the current one
   * @param {number} totalQuestions
   */
  function showQuestionsLeft(questionsLeft, totalQuestions) {
    findElement("session-pill-label").textContent = "Questions left";
    findElement("session-pill-value").textContent =
      questionsLeft + "/" + totalQuestions;
    sessionPill().className = "session-pill";
  }

  /** @returns {HTMLElement} the fixed pill in the top right */
  function sessionPill() {
    return findElement("session-pill");
  }

  quiz.timers = {
    createQuestionTimer,
    setQuestionTimeUpHandler,
    stopQuestionTimer,
    startSessionClock,
    stopSessionClock,
    createSessionClockBar,
    showQuestionsLeft,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
