/*
 * results-screen.js
 * The end of a session: the percentage, the verdict, what to reread,
 * and a record in "Your recent results".
 *
 * Marks: right = 1, partly right = 0.5, missed = 0.
 * Verdict: Excellent is over 90% with more than 15 questions answered,
 * Pass is 60% or more, Needs work is under 60%.
 *
 * Warm-up guesses (pretests) are not scored. A Learn session lists them
 * and the ideas it covered under the score.
 */
(function setUpResultsScreen(quiz) {
  "use strict";

  const {
    findElement,
    createElement,
    createButton,
    countWithWord,
    formatOneDecimal,
    prefersReducedMotion,
  } = quiz.helpers;

  const EXCELLENT_ABOVE_PERCENT = 90;
  const EXCELLENT_NEEDS_MORE_THAN = 15;   // questions in one session
  const PASS_FROM_PERCENT = 60;
  const RECENT_RESULTS_KEPT = 5;
  const COUNT_UP_DURATION_MS = 900;
  const CONFETTI_FOR_EXCELLENT = 60;
  const CONFETTI_FOR_PASS = 32;
  const CONFETTI_DELAY_MS = 250;   // let the results card appear first

  /** What the reader sees. The saved key for "fail" is kept so old
      progress files still load; only its name is gentler. */
  const VERDICT_NAMES = {
    excellent: "Excellent", pass: "Pass", fail: "Needs work",
  };
  const AVERAGE_OF_SESSIONS = 5;
  const RULES_TEXT =
    "Excellent: over " + EXCELLENT_ABOVE_PERCENT + "% with more than " +
    EXCELLENT_NEEDS_MORE_THAN + " questions. Pass: " + PASS_FROM_PERCENT +
    "% or more. Needs work: under " + PASS_FROM_PERCENT +
    "%. A partly-right answer earns half a mark.";

  /**
   * Excellent, pass or fail for a percentage.
   * @param {number} percent
   * @param {number} questionCount
   * @returns {"excellent"|"pass"|"fail"}
   */
  function verdictFor(percent, questionCount) {
    if (percent > EXCELLENT_ABOVE_PERCENT &&
        questionCount > EXCELLENT_NEEDS_MORE_THAN) {
      return "excellent";
    }
    return percent >= PASS_FROM_PERCENT ? "pass" : "fail";
  }

  /**
   * The encouraging line under the score.
   * @param {string} verdict
   * @param {number} percent
   * @param {number} questionCount
   * @returns {string}
   */
  function messageFor(verdict, percent, questionCount) {
    if (verdict === "excellent") {
      return "Strong session. You kept at the questions until the " +
        "answers came, and that is what makes them stick.";
    }
    if (verdict === "fail") {
      return quiz.session.state.isGuided ?
        "Not there yet, and a hard session teaches the most. Open the " +
        "ideas below, read the cards again, then try again." :
        "Not yet. Reread the topics below, then try again.";
    }
    const missedExcellentOnCount = percent > EXCELLENT_ABOVE_PERCENT &&
      questionCount <= EXCELLENT_NEEDS_MORE_THAN;
    if (missedExcellentOnCount) {
      return "Over " + EXCELLENT_ABOVE_PERCENT + "%. Answer " +
        (EXCELLENT_NEEDS_MORE_THAN + 1) +
        " or more questions in one session to earn Excellent.";
    }
    return "You passed. Keep going to make it stick.";
  }

  /** End the session and show how it went. */
  function showResults() {
    quiz.timers.stopQuestionTimer();
    quiz.timers.stopSessionClock();
    const session = quiz.session.state;
    session.keyHandler = null;
    const cardElement = openCardForResults();
    const score = session.score;
    const questionCount = score.got + score.part + score.miss;

    if (questionCount === 0) {
      cardElement.appendChild(createNothingScoredResult());
      return;
    }
    const marks = score.got + 0.5 * score.part;
    const percent = (100 * marks) / questionCount;
    const verdict = verdictFor(percent, questionCount);
    saveToRecentResults(percent, marks, questionCount, verdict);
    const hero = createHero(verdict, percent, marks, questionCount);
    cardElement.appendChild(createResult(verdict, hero.element));
    countUpTo(hero.scoreNumber, percent);
    celebrateIfPassed(verdict, hero.element);
  }

  /**
   * Everything on the results screen below and including the hero card.
   * @param {string} verdict
   * @param {HTMLElement} heroElement
   * @returns {HTMLElement}
   */
  function createResult(verdict, heroElement) {
    const session = quiz.session.state;
    const result = createElement("div", "result result-" + verdict);
    result.appendChild(heroElement);
    result.appendChild(createElement("p", "result-rules", RULES_TEXT));
    result.appendChild(createScoreTally(session.score));
    const wentRight = createWhatWentRight();
    if (wentRight) {
      result.appendChild(wentRight);
    }
    const average = createAverageNote();
    if (average) {
      result.appendChild(average);
    }
    if (session.pretestCount || session.conceptTitles.length) {
      result.appendChild(createLearningSummary());
    }
    if (session.askConfidence && session.confidentMissCount) {
      result.appendChild(createConfidentMissNote(session.confidentMissCount));
    }
    if (session.missedQuestions.length) {
      appendQuestionsToReread(result, session.missedQuestions);
    }
    result.appendChild(createResultButtons());
    return result;
  }

  /**
   * Confetti for a pass, more for excellent, none for a fail.
   * @param {string} verdict
   * @param {HTMLElement} heroElement
   */
  function celebrateIfPassed(verdict, heroElement) {
    if (verdict === "fail") {
      return;
    }
    const pieces =
      verdict === "excellent" ? CONFETTI_FOR_EXCELLENT : CONFETTI_FOR_PASS;
    setTimeout(function celebrateResult() {
      quiz.celebrate(heroElement, pieces);
    }, CONFETTI_DELAY_MS);
  }

  /** @returns {HTMLElement} the question card, emptied for results */
  function openCardForResults() {
    const cardElement = findElement("question-card");
    cardElement.classList.remove("hidden");
    cardElement.textContent = "";
    window.scrollTo({ top: 0 });
    return cardElement;
  }

  /**
   * Shown when nothing was scored: time ran out before the first
   * answer, or the session ended after warm-up guesses only.
   * @returns {HTMLElement}
   */
  function createNothingScoredResult() {
    const session = quiz.session.state;
    const result = createElement("div", "result");
    result.appendChild(createElement("h2", null, session.pretestCount ?
      "Nothing was scored this time." :
      "Time ran out before you answered anything."));
    result.appendChild(createElement("p", "note", session.pretestCount ?
      "Warm-up guesses are not scored. Start a Learn session again " +
      "to carry on with the idea." :
      "This attempt was not recorded."));
    const actions = createElement("div", "actions is-centered");
    actions.appendChild(createButton("Back to start", "button primary",
      quiz.session.returnHome));
    result.appendChild(actions);
    return result;
  }

  /**
   * Add this session to "Your recent results" (newest first, five kept).
   * @param {number} percent
   * @param {number} marks
   * @param {number} questionCount
   * @param {string} verdict
   */
  function saveToRecentResults(percent, marks, questionCount, verdict) {
    const session = quiz.session.state;
    const saved = quiz.progress.saved;
    saved.recentResults.unshift({
      finishedAt: Date.now(),
      percent,
      marks,
      questionCount,
      verdict,
      scopeName: session.scopeName,
      secondsPerQuestion: session.secondsPerQuestion,
      sessionMinutes: session.isTimed ? session.sessionMinutes : 0,
    });
    saved.recentResults = saved.recentResults.slice(0, RECENT_RESULTS_KEPT);
    quiz.progress.saveProgress();
    // Optional add-ons (such as cloud sync) save at the end of a session.
    document.dispatchEvent(new CustomEvent("recallquiz:session-finished"));
  }

  /**
   * The coloured card with the verdict, the percentage and the marks.
   * @param {string} verdict
   * @param {number} percent
   * @param {number} marks
   * @param {number} questionCount
   * @returns {{element: HTMLElement, scoreNumber: Text}}
   */
  function createHero(verdict, percent, marks, questionCount) {
    const session = quiz.session.state;
    const hero = createElement("div", "result-hero pop-in");
    hero.appendChild(
      createElement("span", "result-badge", VERDICT_NAMES[verdict]));

    const scoreLine = createElement("div", "result-score");
    const scoreNumber = document.createTextNode("0");
    scoreLine.appendChild(scoreNumber);
    scoreLine.appendChild(createElement("small", null, "%"));
    hero.appendChild(scoreLine);

    hero.appendChild(createElement("div", "result-marks",
      "Marks: " + formatOneDecimal(marks) + " out of " + questionCount));
    if (session.isTimed) {
      hero.appendChild(createElement("div", "result-detail",
        countWithWord(questionCount, "question") + " answered in a " +
        session.sessionMinutes + " minute session"));
    }
    hero.appendChild(createElement("p", "result-message",
      messageFor(verdict, percent, questionCount)));
    return { element: hero, scoreNumber };
  }

  /**
   * Got it / Partly / Missed counts.
   * @param {{got: number, part: number, miss: number}} score
   * @returns {HTMLElement}
   */
  function createScoreTally(score) {
    const tally = createElement("div", "score-tally");
    [
      { key: "got", label: "Got it" },
      { key: "part", label: "Partly" },
      { key: "miss", label: "Not yet" },
    ].forEach(function addCount(entry) {
      const box = createElement("div", "score-" + entry.key);
      box.appendChild(createElement("b", null, String(score[entry.key])));
      box.appendChild(createElement("span", null, entry.label));
      tally.appendChild(box);
    });
    return tally;
  }

  /**
   * "What went right": the ideas answered right with no miss this
   * session, or just the count. Shown first, before anything to fix.
   * @returns {HTMLElement|null}
   */
  function createWhatWentRight() {
    const session = quiz.session.state;
    const right = session.rightQuestions;
    if (right.length === 0) {
      return null;
    }
    const missedIdeas = new Set(session.missedQuestions.map(
      function conceptOf(question) {
        return question.concept;
      }));
    const titles = [];
    right.forEach(function collect(question) {
      const concept = quiz.learning.conceptById(question.concept);
      if (concept && !missedIdeas.has(concept.id) &&
          !titles.includes(concept.title)) {
        titles.push(concept.title);
      }
    });
    const line = createElement("p", "note went-right");
    line.appendChild(createElement("b", null, "What went right: "));
    line.appendChild(document.createTextNode(
      countWithWord(right.length, "answer") + " right" + (titles.length ?
        ", with no slips on " + titles.slice(0, 3).join(", ") + "." : ".")));
    return line;
  }

  /**
   * The average of the last few sessions, with a reminder that one
   * session is a noisy measure. Needs at least two sessions.
   * @returns {HTMLElement|null}
   */
  function createAverageNote() {
    const results = quiz.progress.saved.recentResults
      .slice(0, AVERAGE_OF_SESSIONS);
    if (results.length < 2) {
      return null;
    }
    const total = results.reduce(function add(sum, result) {
      return sum + result.percent;
    }, 0);
    return createElement("p", "note average-note",
      "Your last " + results.length + " sessions average " +
      formatOneDecimal(total / results.length) + "%. One session is " +
      "a noisy measure, so judge yourself by the trend.");
  }

  /**
   * "Ideas this session: ..." and the number of warm-up guesses, which
   * are not part of the score.
   * @returns {HTMLElement}
   */
  function createLearningSummary() {
    const session = quiz.session.state;
    const summary = createElement("p", "note learning-summary");
    const parts = [];
    if (session.conceptTitles.length) {
      parts.push("Ideas this session: " + session.conceptTitles.join(", ") +
        ".");
    }
    if (session.pretestCount) {
      parts.push(countWithWord(session.pretestCount, "warm-up guess",
        "warm-up guesses") + " not scored. The questions you did " +
        "score will come back by spaced review.");
    }
    summary.textContent = parts.join(" ");
    return summary;
  }

  /**
   * "2 confident misses: you were certain and wrong...".
   * @param {number} count
   * @returns {HTMLElement}
   */
  function createConfidentMissNote(count) {
    return createElement("p", "confident-miss",
      countWithWord(count, "confident miss", "confident misses") +
      ": you were certain and wrong. These are the best things to reread.");
  }

  /**
   * The list of missed questions, each with where to reread it.
   * @param {HTMLElement} result
   * @param {object[]} missedQuestions
   */
  function appendQuestionsToReread(result, missedQuestions) {
    result.appendChild(createElement("p", "note revisit-heading",
      "Reread these before the next session. They will come back sooner."));
    const list = createElement("ul", "revisit-list");
    missedQuestions.forEach(function addMissedQuestion(question) {
      const item = createElement("li", null, question.q);
      item.appendChild(createElement("span", null,
        quiz.learning.rereadText(question)));
      list.appendChild(item);
    });
    result.appendChild(list);
  }

  /** @returns {HTMLElement} "Practise again" and "Back to start" */
  function createResultButtons() {
    const actions = createElement("div", "actions is-centered");
    const hasIdeas = quiz.learning.hasConcepts();
    actions.appendChild(createButton(
      hasIdeas ? "Keep going" : "Practise again", "button primary",
      function practiseAgain() {
        quiz.session.returnHome();
        quiz.session.startSession(
          hasIdeas ? quiz.settings.chooseKeepGoing() : undefined);
      }));
    actions.appendChild(createButton("Back to start", "button",
      quiz.session.returnHome));
    return actions;
  }

  /**
   * Count the percentage up from 0 for a bit of drama.
   * @param {Text} scoreNumber  the text node to update
   * @param {number} percent
   */
  function countUpTo(scoreNumber, percent) {
    const target = Math.round(percent * 10) / 10;
    if (prefersReducedMotion()) {
      scoreNumber.nodeValue = formatOneDecimal(target);
      return;
    }
    let startTime = null;
    /** Draw one animation frame of the count-up. */
    function step(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }
      const progress =
        Math.min((timestamp - startTime) / COUNT_UP_DURATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      scoreNumber.nodeValue = formatOneDecimal(target * easedProgress);
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }
    step(performance.now());
  }

  quiz.resultsScreen = { showResults };
})((window.RecallQuiz = window.RecallQuiz || {}));
