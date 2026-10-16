/*
 * book.js
 * Holds the book loaded from questions.json and answers questions about
 * it: which chapters it has, what each chapter is called, and the words
 * this book uses ("Chapter", "Topic", ...).
 */
(function setUpBook(quiz) {
  "use strict";

  /**
   * Words that can change from book to book. A course might say "Lesson"
   * instead of "Chapter". questions.json can override any of them in an
   * optional "labels" object.
   */
  const DEFAULT_LABELS = {
    unit: "Chapter",
    units: "chapters",
    topic: "Topic",
    idea: "Idea",
    whole: "Whole book",
  };

  const book = {
    /** The parsed questions.json: { id, book, labels, questions } */
    data: null,
    /** The words to use, defaults merged with questions.json "labels" */
    labels: Object.assign({}, DEFAULT_LABELS),
    /** Chapter ids (the "unit" field) in the order they first appear */
    unitIds: [],
    /** Chapter titles, keyed by chapter id */
    unitTitles: {},
    /** Ids of questions the reader flagged Bad or Useless; they are left
        out of everything (see book-settings.js) */
    hiddenIds: new Set(),
    /** allQuestions() result, kept until the hidden ids change */
    visibleQuestions: null,
  };

  /**
   * Use this book's data. Throws if it has no questions.
   * @param {object} bookData  the parsed questions.json
   */
  function setBookData(bookData) {
    const hasQuestions =
      bookData && bookData.questions && bookData.questions.length;
    if (!hasQuestions) {
      throw new Error("questions.json has no questions");
    }
    book.data = bookData;
    book.labels = Object.assign({}, DEFAULT_LABELS, bookData.labels);
    book.hiddenIds = new Set();
    book.visibleQuestions = null;
    collectUnits(bookData.questions);
  }

  /**
   * Leave these questions out of the book (flagged Bad or Useless).
   * @param {Iterable<string>} questionIds
   */
  function setHiddenIds(questionIds) {
    book.hiddenIds = new Set(questionIds);
    book.visibleQuestions = null;
  }

  /**
   * Work out the list of chapters from the questions, in book order.
   * @param {object[]} questions
   */
  function collectUnits(questions) {
    book.unitIds = [];
    book.unitTitles = {};
    questions.forEach(function rememberUnit(question) {
      if (!book.unitIds.includes(question.unit)) {
        book.unitIds.push(question.unit);
        book.unitTitles[question.unit] = question.unitTitle || "";
      }
    });
  }

  /** @returns {object[]} every question in the book, except hidden ones */
  function allQuestions() {
    if (!book.visibleQuestions) {
      book.visibleQuestions = book.hiddenIds.size === 0 ?
        book.data.questions : book.data.questions.filter(
          function isVisible(question) {
            return !book.hiddenIds.has(question.id);
          });
    }
    return book.visibleQuestions;
  }

  /**
   * @param {string} unitId
   * @returns {string[]} the topics (sections) of a chapter, in book order
   */
  function sectionsInUnit(unitId) {
    const sections = [];
    book.data.questions.forEach(function collect(question) {
      const isNew = question.unit === unitId && question.section &&
        !sections.includes(question.section);
      if (isNew) {
        sections.push(question.section);
      }
    });
    return sections;
  }

  /**
   * True if a question is inside the lesson the reader picked.
   * @param {object} question
   * @param {{unit?: string, section?: string, concept?: string}} scope
   *   unit "all" or missing means the whole book
   * @returns {boolean}
   */
  function matchesScope(question, scope) {
    const wanted = scope || {};
    if (!wanted.unit || wanted.unit === "all") {
      return true;
    }
    return question.unit === wanted.unit &&
      (!wanted.section || question.section === wanted.section) &&
      (!wanted.concept || question.concept === wanted.concept);
  }

  /** @returns {string} the id used to keep this book's progress apart */
  function bookId() {
    return book.data.id || "book";
  }

  /**
   * The number part of a chapter id: "Chapter 9" gives "9".
   * @param {string} unitId
   * @returns {string}
   */
  function unitNumber(unitId) {
    return unitId.replace(/^\D+/, "");
  }

  /**
   * The short chapter name for a question, e.g. "Chapter 9".
   * Named units such as "Introduction" or "Rule #1" are kept as is.
   * @param {object} question
   * @returns {string}
   */
  function unitShortName(question) {
    const unitId = question.unit;
    const usesLabel = /^\d/.test(unitId) ||
      /^chapter\s/i.test(unitId) ||
      unitId.indexOf(book.labels.unit + " ") === 0;
    if (!usesLabel) {
      return unitId;
    }
    return book.labels.unit + " " + unitNumber(unitId);
  }

  /**
   * The full chapter name for a question,
   * e.g. "Chapter 9, Answering an Easier Question".
   * @param {object} question
   * @returns {string}
   */
  function unitFullName(question) {
    const title = question.unitTitle ? ", " + question.unitTitle : "";
    return unitShortName(question) + title;
  }

  /**
   * The questions in one chapter.
   * @param {string} unitId
   * @returns {object[]}
   */
  function questionsInUnit(unitId) {
    return allQuestions().filter(function isInUnit(question) {
      return question.unit === unitId;
    });
  }

  quiz.book = Object.assign(book, {
    setBookData,
    setHiddenIds,
    sectionsInUnit,
    matchesScope,
    allQuestions,
    bookId,
    unitShortName,
    unitFullName,
    questionsInUnit,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
