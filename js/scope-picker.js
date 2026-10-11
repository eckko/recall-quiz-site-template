/*
 * scope-picker.js
 * The lesson picker: cascading drop-downs that narrow what a session
 * covers. The first drop-down lists the chapters ("Whole book" first),
 * the second the topics of the chosen chapter, the third the ideas of the
 * chosen topic. A level appears only when the book has it (a book
 * without ideas has no third drop-down). The words come from the book's
 * labels ("Chapter", "Topic", "Idea" unless questions.json says
 * otherwise).
 *
 * There are two sets: the home screen's picker (the lesson for this
 * visit) and the Settings screen's default picker (the lesson each visit
 * starts with, kept per book).
 *
 * A lesson choice is an object: {unit: "all"} for the whole book, or
 * {unit, section?, concept?}. quiz.book.matchesScope tests a question
 * against it.
 */
(function setUpScopePicker(quiz) {
  "use strict";

  const { findElement } = quiz.helpers;

  /**
   * Controls for one set of three drop-downs.
   * @param {{unit: string, topic: string, idea: string,
   *          topicField: string, ideaField: string,
   *          unitLabel: string, topicLabel: string,
   *          ideaLabel: string}} ids  element ids
   * @returns {object} fill, read, write, onChange
   */
  function createController(ids) {
    const unitSelect = findElement(ids.unit);
    const topicSelect = findElement(ids.topic);
    const ideaSelect = findElement(ids.idea);
    let changeHandler = null;

    /** Tell whoever listens that the reader changed the lesson. */
    function notify() {
      if (changeHandler) {
        changeHandler(read());
      }
    }

    /** Fill the chapter list and set the words for this book. */
    function fill() {
      const labels = quiz.book.labels;
      findElement(ids.unitLabel).textContent = labels.unit;
      findElement(ids.topicLabel).textContent = labels.topic;
      findElement(ids.ideaLabel).textContent = labels.idea;
      unitSelect.textContent = "";
      unitSelect.appendChild(new Option(labels.whole, "all"));
      quiz.book.unitIds.forEach(function addUnit(unitId) {
        const title = quiz.book.unitTitles[unitId];
        unitSelect.appendChild(
          new Option(unitId + (title ? ": " + title : ""), unitId));
      });
      fillTopics();
    }

    /** Fill the topics of the chosen chapter (none for "Whole book"). */
    function fillTopics() {
      const labels = quiz.book.labels;
      const unitId = unitSelect.value;
      const topics = unitId === "all" ? [] :
        quiz.book.sectionsInUnit(unitId);
      topicSelect.textContent = "";
      topicSelect.appendChild(
        new Option("All " + labels.topic.toLowerCase() + "s", ""));
      topics.forEach(function addTopic(section) {
        topicSelect.appendChild(new Option(section, section));
      });
      findElement(ids.topicField).classList.toggle("hidden",
        topics.length === 0);
      fillIdeas();
    }

    /** Fill the ideas of the chosen topic (only for books with ideas). */
    function fillIdeas() {
      const labels = quiz.book.labels;
      const ideas = ideasOfTopic(unitSelect.value, topicSelect.value);
      ideaSelect.textContent = "";
      ideaSelect.appendChild(
        new Option("All " + labels.idea.toLowerCase() + "s", ""));
      ideas.forEach(function addIdea(concept) {
        ideaSelect.appendChild(new Option(concept.title, concept.id));
      });
      findElement(ids.ideaField).classList.toggle("hidden",
        ideas.length === 0);
    }

    /** @returns {{unit: string, section?: string, concept?: string}} */
    function read() {
      const scope = { unit: unitSelect.value || "all" };
      if (scope.unit !== "all" && topicSelect.value) {
        scope.section = topicSelect.value;
        if (ideaSelect.value) {
          scope.concept = ideaSelect.value;
        }
      }
      return scope;
    }

    /**
     * Show a lesson choice. Parts this book does not have are ignored.
     * @param {{unit?: string, section?: string, concept?: string}} scope
     */
    function write(scope) {
      const wanted = scope || {};
      unitSelect.value = hasOption(unitSelect, wanted.unit) ?
        wanted.unit : "all";
      fillTopics();
      if (hasOption(topicSelect, wanted.section)) {
        topicSelect.value = wanted.section;
        fillIdeas();
        if (hasOption(ideaSelect, wanted.concept)) {
          ideaSelect.value = wanted.concept;
        }
      }
    }

    unitSelect.addEventListener("change", function onUnit() {
      fillTopics();
      notify();
    });
    topicSelect.addEventListener("change", function onTopic() {
      fillIdeas();
      notify();
    });
    ideaSelect.addEventListener("change", notify);

    return {
      fill,
      read,
      write,
      onChange: function onChange(handler) {
        changeHandler = handler;
      },
    };
  }

  /**
   * @param {HTMLSelectElement} select
   * @param {string|undefined} value
   * @returns {boolean} true if the drop-down has a real option with it
   */
  function hasOption(select, value) {
    return Boolean(value) && Array.from(select.options).some(
      function matches(option) {
        return option.value === value;
      });
  }

  /**
   * The ideas in a topic, in book order.
   * @param {string} unitId  "all" for none
   * @param {string} section  "" for none
   * @returns {object[]}
   */
  function ideasOfTopic(unitId, section) {
    if (unitId === "all" || !section || !quiz.learning.hasConcepts()) {
      return [];
    }
    return quiz.learning.concepts().filter(function isInTopic(concept) {
      return concept.unit === unitId && concept.section === section;
    });
  }

  /**
   * A short name for a lesson choice, for results and summaries.
   * @param {{unit?: string, section?: string, concept?: string}} scope
   * @returns {string}
   */
  function scopeName(scope) {
    const wanted = scope || {};
    if (wanted.concept) {
      const concept = quiz.learning.conceptById(wanted.concept);
      return concept ? concept.title : wanted.concept;
    }
    if (wanted.section) {
      return wanted.section;
    }
    return !wanted.unit || wanted.unit === "all" ?
      quiz.book.labels.whole : wanted.unit;
  }

  const home = createController({
    unit: "unit-picker", topic: "topic-picker", idea: "idea-picker",
    topicField: "topic-field", ideaField: "idea-field",
    unitLabel: "unit-picker-label", topicLabel: "topic-picker-label",
    ideaLabel: "idea-picker-label",
  });
  const defaults = createController({
    unit: "default-unit", topic: "default-topic", idea: "default-idea",
    topicField: "default-topic-field", ideaField: "default-idea-field",
    unitLabel: "default-unit-label", topicLabel: "default-topic-label",
    ideaLabel: "default-idea-label",
  });

  /** Fill both sets of drop-downs when a book is loaded. */
  function fill() {
    home.fill();
    defaults.fill();
  }

  /**
   * Call a function when the reader changes the default lesson on the
   * Settings screen.
   * @param {function(object): void} handler  gets the lesson choice
   */
  function setUpDefaults(handler) {
    defaults.onChange(handler);
  }

  /**
   * Show the saved default lesson on the Settings screen.
   * @param {object} scope
   */
  function showDefaultScope(scope) {
    if (quiz.book && quiz.book.data) {
      defaults.write(scope);
    }
  }

  quiz.scopePicker = {
    fill,
    read: home.read,
    write: home.write,
    onChange: home.onChange,
    setUpDefaults,
    showDefaultScope,
    scopeName,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
