/*
 * progress-merge.js
 * Combines two copies of the same book's progress, for example the copy in
 * this browser and the copy saved in the reader's account. It knows nothing
 * about any database; cloud-sync.js uses it whichever one is plugged in.
 *
 * Rules:
 *  - Each question keeps the record that was answered most recently
 *    (higher lastAnswered). On a tie, the one seen more often wins.
 *  - Days practised are combined.
 *  - Recent results are combined, newest first, five kept.
 *  - Reset and Load stamp the progress with resetAt. The copy with the
 *    newest stamp is kept whole; from the other copy, only answers made
 *    after that stamp are kept. So a reset (or a loaded backup) on one
 *    device is not undone by another device's older copy.
 */
(function setUpProgressMerge(quiz) {
  "use strict";

  const RECENT_RESULTS_KEPT = 5;

  /**
   * @param {object|null} first   progress, any version
   * @param {object|null} second  progress, any version
   * @returns {object} one combined version 2 progress object
   */
  function mergeProgress(first, second) {
    const upgrade = quiz.progress.upgradeSavedProgress;
    let a = upgrade(first);
    let b = upgrade(second);
    const aResetAt = a.resetAt || 0;
    const bResetAt = b.resetAt || 0;
    if (aResetAt > bResetAt) {
      b = keepOnlyAfter(b, aResetAt);
    } else if (bResetAt > aResetAt) {
      a = keepOnlyAfter(a, bResetAt);
    }

    const merged = quiz.progress.createEmptyProgress();
    const resetAt = Math.max(aResetAt, bResetAt);
    if (resetAt) {
      merged.resetAt = resetAt;
    }
    merged.questions = mergeQuestions(a.questions, b.questions);
    merged.daysPracticed = mergeDays(a.daysPracticed, b.daysPracticed);
    merged.recentResults = mergeResults(a.recentResults, b.recentResults);
    return merged;
  }

  /**
   * A copy of progress without anything from before a time.
   * @param {object} progress  version 2 progress
   * @param {number} time      milliseconds
   * @returns {object}
   */
  function keepOnlyAfter(progress, time) {
    const questions = {};
    Object.keys(progress.questions).forEach(function keepIfNewer(id) {
      const record = progress.questions[id];
      if ((record.lastAnswered || 0) > time) {
        questions[id] = record;
      }
    });
    const firstDay = startOfDay(new Date(time));
    return Object.assign({}, progress, {
      questions,
      daysPracticed: progress.daysPracticed.filter(
        function isOnOrAfter(day) { return dayStart(day) >= firstDay; }),
      recentResults: progress.recentResults.filter(
        function isAfter(result) { return (result.finishedAt || 0) > time; }),
    });
  }

  /**
   * Keep the newer record of every question.
   * @returns {object} question id to record
   */
  function mergeQuestions(first, second) {
    const merged = {};
    const ids = new Set(Object.keys(first).concat(Object.keys(second)));
    ids.forEach(function pickNewer(id) {
      merged[id] = Object.assign({}, newerRecord(first[id], second[id]));
    });
    return merged;
  }

  /** @returns {object} the more recently answered record */
  function newerRecord(one, two) {
    if (!one) { return two; }
    if (!two) { return one; }
    const oneTime = one.lastAnswered || 0;
    const twoTime = two.lastAnswered || 0;
    if (oneTime !== twoTime) {
      return oneTime > twoTime ? one : two;
    }
    return (two.timesSeen || 0) > (one.timesSeen || 0) ? two : one;
  }

  /**
   * Combine the days practised. Days look like "2026-10-5" (see
   * spaced-repetition.js).
   * @returns {string[]}
   */
  function mergeDays(first, second) {
    const all = first.concat(second);
    return all.filter(function isFirstCopy(day, index) {
      return all.indexOf(day) === index;
    });
  }

  /** @returns {number} midnight of a "2026-10-5" day, in ms */
  function dayStart(day) {
    const parts = String(day).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  }

  /** @returns {number} midnight of the given date, in ms */
  function startOfDay(date) {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Combine recent results, newest first, without duplicates.
   * @returns {object[]}
   */
  function mergeResults(first, second) {
    const seen = new Set();
    return first.concat(second)
      .filter(function isFirstCopy(result) {
        if (seen.has(result.finishedAt)) {
          return false;
        }
        seen.add(result.finishedAt);
        return true;
      })
      .sort(function newestFirst(x, y) { return y.finishedAt - x.finishedAt; })
      .slice(0, RECENT_RESULTS_KEPT);
  }

  /**
   * True when two progress objects hold the same data (ignores key order
   * at the top level, which is enough for deciding whether to upload).
   */
  function sameProgress(first, second) {
    return JSON.stringify(normalised(first)) ===
      JSON.stringify(normalised(second));
  }

  /** @returns {Array} progress in a fixed order, for comparing */
  function normalised(progress) {
    const p = quiz.progress.upgradeSavedProgress(progress);
    const questions = {};
    Object.keys(p.questions).sort().forEach(function copy(id) {
      questions[id] = p.questions[id];
    });
    return [questions, p.daysPracticed.slice().sort(), p.recentResults,
      p.resetAt || 0];
  }

  quiz.progressMerge = { mergeProgress, sameProgress };
})((window.RecallQuiz = window.RecallQuiz || {}));
