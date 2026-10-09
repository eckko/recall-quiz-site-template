/*
 * spaced-repetition.js
 * Decides when each question should come back.
 *
 * Every question has a memory level from 0 to 4. A right answer moves it
 * up one level, a miss sends it back to 0, and "partly right" keeps it
 * where it is. The level sets how many days until it is due again:
 *
 *   level:        0   1   2   3   4
 *   days until:   0   1   3   7  21
 *
 * Level 3 or more counts as "solid" on the home screen.
 *
 * A pretest (an unscored guess before an idea is taught, see
 * learning.js) is kept apart: recordPretest marks the question as
 * pretested without touching its level or counts.
 */
(function setUpSpacedRepetition(quiz) {
  "use strict";

  const DAYS_UNTIL_REVIEW_BY_LEVEL = [0, 1, 3, 7, 21];
  const HIGHEST_LEVEL = DAYS_UNTIL_REVIEW_BY_LEVEL.length - 1;
  const SOLID_LEVEL = 3;
  const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

  /** @returns {object} the saved progress of every question */
  function savedQuestions() {
    return quiz.progress.saved.questions;
  }

  /**
   * The saved progress of one question.
   * @param {string} questionId
   * @returns {object|undefined}  undefined if never answered
   */
  function getQuestionRecord(questionId) {
    return savedQuestions()[questionId];
  }

  /**
   * Update a question after it was answered, then save.
   * @param {string} questionId
   * @param {"got"|"part"|"miss"} result
   * @param {boolean} wasConfidentMiss  "Certain" was chosen, but wrong
   */
  function recordAnswer(questionId, result, wasConfidentMiss) {
    const now = Date.now();
    const record = getQuestionRecord(questionId) || createNewRecord();
    if (result === "miss") {
      record.memoryLevel = 0;
      record.timesMissed += 1;
      record.nextReview = now;
    } else {
      if (result === "got") {
        record.memoryLevel = Math.min(record.memoryLevel + 1, HIGHEST_LEVEL);
      }
      const daysToWait = DAYS_UNTIL_REVIEW_BY_LEVEL[record.memoryLevel];
      record.nextReview = now + daysToWait * ONE_DAY_IN_MS;
    }
    if (wasConfidentMiss) {
      record.confidentMisses += 1;
    }
    record.timesSeen += 1;
    record.lastAnswered = now;
    savedQuestions()[questionId] = record;
    rememberTodayAsPracticed();
    quiz.progress.saveProgress();
  }

  /**
   * Note a pretest (an unscored guess made before the idea was taught).
   * It changes no memory level and no counts: the question is simply
   * marked as pretested and is due straight away, so it comes back as an
   * ordinary scored question once the idea has been learned. A question
   * that has already been scored is left alone.
   * @param {string} questionId
   * @param {"got"|"part"|"miss"} result  how the guess went
   */
  function recordPretest(questionId, result) {
    if (isScored(questionId)) {
      return;
    }
    const record = getQuestionRecord(questionId) || createNewRecord();
    record.pretested = true;
    record.pretestResult = result;
    record.lastAnswered = Date.now();
    savedQuestions()[questionId] = record;
    rememberTodayAsPracticed();
    quiz.progress.saveProgress();
  }

  /**
   * True if a question has been answered as a scored question (a
   * pretest alone does not count).
   * @param {string} questionId
   * @returns {boolean}
   */
  function isScored(questionId) {
    const record = getQuestionRecord(questionId);
    return Boolean(record) && record.timesSeen > 0;
  }

  /**
   * The memory level of a question, 0 if it was never scored.
   * @param {string} questionId
   * @returns {number}
   */
  function memoryLevelOf(questionId) {
    const record = getQuestionRecord(questionId);
    return record && record.timesSeen > 0 ? record.memoryLevel : 0;
  }

  /** @returns {object} the record for a question never answered before */
  function createNewRecord() {
    return {
      memoryLevel: 0,
      timesSeen: 0,
      timesMissed: 0,
      nextReview: 0,
      lastAnswered: 0,
      confidentMisses: 0,
    };
  }

  /**
   * True if a question should be asked now: new, or its time has come.
   * @param {string} questionId
   * @returns {boolean}
   */
  function isDueOrNew(questionId) {
    const record = getQuestionRecord(questionId);
    return !record || record.nextReview <= Date.now();
  }

  /**
   * True if a question was answered before and is due again now.
   * @param {string} questionId
   * @returns {boolean}
   */
  function isWaitingForReview(questionId) {
    const record = getQuestionRecord(questionId);
    return isScored(questionId) && record.nextReview <= Date.now();
  }

  /**
   * True if the reader has missed this question and it is still weak.
   * @param {string} questionId
   * @returns {boolean}
   */
  function isGap(questionId) {
    const record = getQuestionRecord(questionId);
    return Boolean(record) && record.timesMissed > 0 &&
      record.memoryLevel <= 1;
  }

  /**
   * True if a question has been answered right several times in a row.
   * @param {string} questionId
   * @returns {boolean}
   */
  function isSolid(questionId) {
    const record = getQuestionRecord(questionId);
    return Boolean(record) && record.memoryLevel >= SOLID_LEVEL;
  }

  /**
   * True if a question has been seen but is not solid yet.
   * @param {string} questionId
   * @returns {boolean}
   */
  function isLearning(questionId) {
    return isScored(questionId) && !isSolid(questionId);
  }

  /**
   * How many times a question has been missed.
   * @param {string} questionId
   * @returns {number}
   */
  function timesMissed(questionId) {
    const record = getQuestionRecord(questionId);
    return record ? record.timesMissed : 0;
  }

  /**
   * A short key for a calendar day, e.g. "2026-10-5".
   * @param {Date} date
   * @returns {string}
   */
  function dayKey(date) {
    const month = date.getMonth() + 1;
    return date.getFullYear() + "-" + month + "-" + date.getDate();
  }

  /** Add today to the list of days with practice. */
  function rememberTodayAsPracticed() {
    const today = dayKey(new Date());
    const days = quiz.progress.saved.daysPracticed;
    if (!days.includes(today)) {
      days.push(today);
    }
  }

  /**
   * How many days in a row the reader has practised. Counting starts
   * today, or yesterday if they have not practised yet today.
   * @returns {number}
   */
  function currentDayStreak() {
    const days = quiz.progress.saved.daysPracticed;
    let day = new Date();
    if (!days.includes(dayKey(day))) {
      day = new Date(Date.now() - ONE_DAY_IN_MS);
    }
    let streak = 0;
    while (days.includes(dayKey(day))) {
      streak += 1;
      day = new Date(day.getTime() - ONE_DAY_IN_MS);
    }
    return streak;
  }

  /** @returns {number} all the days the reader has practised */
  function countDaysPracticed() {
    return quiz.progress.saved.daysPracticed.length;
  }

  /** @returns {number} questions answered since midnight */
  function countAnsweredToday() {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const records = Object.values(savedQuestions());
    return records.filter(function answeredToday(record) {
      return record.lastAnswered >= midnight.getTime();
    }).length;
  }

  quiz.memory = {
    recordAnswer,
    recordPretest,
    isScored,
    memoryLevelOf,
    isDueOrNew,
    isWaitingForReview,
    isGap,
    isSolid,
    isLearning,
    timesMissed,
    currentDayStreak,
    countDaysPracticed,
    countAnsweredToday,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
