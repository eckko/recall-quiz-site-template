/*
 * htrab.js
 * The HTRAB overlay: tags every question with a step from "How to Read a
 * Book" (level / topic / subtopic), lets the reader test one step at a
 * time, and shows Adler's advice for the step next to the feedback.
 *
 * It is an add-on. The rest of the app knows nothing about it except
 * three events it sends (book-opened, question-shown, feedback-shown) and
 * the existing quiz.session.startQuestions. Delete the htrab/ folder and
 * its three tags in index.html and the quiz works as before.
 *
 * A question or concept joins in with one field, "htrab", holding a
 * tag written level/topic/subtopic (see htrab/README.md for examples).
 */
(function setUpHtrab(quiz) {
  "use strict";

  const config = window.RecallQuizHtrab;
  if (!config || !config.available) {
    return;
  }

  const { findElement, createElement, createButton } = quiz.helpers;
  const STAGE_NAMES = {
    "1": "Stage 1: What is the book about?",
    "2": "Stage 2: What is being said?",
    "3": "Stage 3: Is it true? What of it?",
    kind: "By kind of book",
  };
  const MOST_ADVICE_ITEMS = 3;
  const TYPE_ORDER = ["rule", "question", "advice", "warning",
    "definition", "distinction", "exercise"];

  const state = {
    isOn: false,
    defaultOn: false,
    tree: null,
    catalogue: null,
    loadFailed: false,
    pick: { level: "", stage: "", topic: "", sub: "" },
    panel: null,
    switchRows: [],
  };

  // --------------------------------------------------------------- data

  /** Fetch the tag tree and Adler's advice once, when first needed. */
  function loadData() {
    if (state.tree || state.loadFailed) {
      return Promise.resolve();
    }
    return Promise.all([
      fetch("htrab/tags.json").then(function read(response) {
        return response.json();
      }),
      fetch("htrab/catalogue.json").then(function read(response) {
        return response.json();
      }),
    ]).then(function keep(results) {
      state.tree = results[0];
      state.catalogue = results[1];
    }).catch(function failed() {
      state.loadFailed = true;
    });
  }

  /**
   * @param {object} question  a question, or a lesson step
   * @returns {string}  its HTRAB tag, or "" (a question falls back to
   *                    the tag of its idea)
   */
  function tagOf(question) {
    if (question.htrab) {
      return question.htrab;
    }
    const concept = quiz.learning.conceptById(question.concept);
    return concept && concept.htrab ? concept.htrab : "";
  }

  /**
   * @param {string} tag
   * @returns {{level: object, topic: object, sub: object}|null} the
   *   nodes of the tag tree the tag points to
   */
  function nodesOf(tag) {
    const parts = tag.split("/");
    const level = state.tree.levels.find(function is(node) {
      return node.id === parts[0];
    });
    const topic = level && level.topics.find(function is(node) {
      return node.id === parts[1];
    });
    const sub = topic && topic.subtopics.find(function is(node) {
      return node.id === parts[2];
    });
    return sub ? { level, topic, sub } : null;
  }

  /** @returns {object[]} the bank's questions that carry a tag */
  function taggedQuestions() {
    return quiz.book.allQuestions().filter(function hasTag(question) {
      return question.role !== "pretest" && tagOf(question) !== "";
    });
  }

  // ------------------------------------------------------------- picker

  /**
   * True if a question fits what the reader picked so far.
   * @param {object} question
   * @returns {boolean}
   */
  function matchesPick(question) {
    const nodes = nodesOf(tagOf(question));
    if (!nodes) {
      return false;
    }
    const pick = state.pick;
    return (!pick.level || nodes.level.id === pick.level) &&
      (!pick.stage || nodes.topic.stage === pick.stage) &&
      (!pick.topic || nodes.topic.id === pick.topic) &&
      (!pick.sub || nodes.sub.id === pick.sub);
  }

  /**
   * Fill a drop-down with "Any" and the given choices.
   * @param {string} id  the select's element id
   * @param {{value: string, label: string}[]} choices
   * @param {string} chosen  the value to select
   */
  function fillSelect(id, choices, chosen) {
    const select = findElement(id);
    select.textContent = "";
    select.appendChild(new Option("Any", ""));
    choices.forEach(function add(choice) {
      select.appendChild(new Option(choice.label, choice.value));
    });
    select.value = chosen;
  }

  /**
   * The distinct nodes (level, topic, subtopic) used by the bank, which
   * is all the picker offers.
   * @returns {object[]} one entry per tagged question
   */
  function usedNodes() {
    return taggedQuestions().map(function toNodes(question) {
      return nodesOf(tagOf(question));
    }).filter(Boolean).sort(function byBookOrder(first, second) {
      return treePosition(first) - treePosition(second);
    });
  }

  /**
   * Where a tag sits in tags.json, so choices appear in reading order
   * rather than in the order the questions happen to be written.
   * @param {{level: object, topic: object, sub: object}} nodes
   * @returns {number} a number that grows with the tag's position
   */
  function treePosition(nodes) {
    const levelAt = state.tree.levels.indexOf(nodes.level);
    const topicAt = nodes.level.topics.indexOf(nodes.topic);
    const subAt = nodes.topic.subtopics.indexOf(nodes.sub);
    return levelAt * 1000000 + topicAt * 1000 + subAt;
  }

  /**
   * @param {object[]} entries
   * @param {function(object): {value: string, label: string}} pick
   * @returns {{value: string, label: string}[]} distinct choices
   */
  function distinctChoices(entries, pick) {
    const seen = new Set();
    const choices = [];
    entries.forEach(function add(entry) {
      const choice = pick(entry);
      if (!seen.has(choice.value)) {
        seen.add(choice.value);
        choices.push(choice);
      }
    });
    return choices;
  }

  /** Redraw the four drop-downs and the match count. */
  function renderPicker() {
    const pick = state.pick;
    const nodes = usedNodes();
    fillSelect("htrab-level", distinctChoices(nodes, function level(n) {
      return { value: n.level.id, label: n.level.label };
    }), pick.level);

    const inLevel = nodes.filter(function fits(n) {
      return !pick.level || n.level.id === pick.level;
    });
    const stages = distinctChoices(inLevel.filter(function has(n) {
      return n.topic.stage;
    }), function stage(n) {
      return { value: n.topic.stage, label: STAGE_NAMES[n.topic.stage] };
    });
    findElement("htrab-stage-field")
      .classList.toggle("hidden", stages.length === 0);
    fillSelect("htrab-stage", stages, pick.stage);

    const inStage = inLevel.filter(function fits(n) {
      return !pick.stage || n.topic.stage === pick.stage;
    });
    fillSelect("htrab-topic", distinctChoices(inStage, function topic(n) {
      return { value: n.topic.id, label: n.topic.label };
    }), pick.topic);

    const inTopic = inStage.filter(function fits(n) {
      return !pick.topic || n.topic.id === pick.topic;
    });
    fillSelect("htrab-sub", distinctChoices(inTopic, function sub(n) {
      return { value: n.sub.id, label: n.sub.label };
    }), pick.sub);
    showMatchCount();
  }

  /** Say how many questions match, and enable the start button. */
  function showMatchCount() {
    const count = taggedQuestions().filter(matchesPick).length;
    findElement("htrab-count").textContent = count ?
      count + " question" + (count === 1 ? "" : "s") + " match." :
      "No questions match these choices.";
    findElement("htrab-start").disabled = count === 0;
  }

  /**
   * The reader changed one drop-down: keep it, clear the ones below it.
   * @param {"level"|"stage"|"topic"|"sub"} key
   * @param {string} value
   */
  function choose(key, value) {
    const order = ["level", "stage", "topic", "sub"];
    state.pick[key] = value;
    order.slice(order.indexOf(key) + 1).forEach(function clear(lower) {
      state.pick[lower] = "";
    });
    renderPicker();
  }

  /** Start a test with only the questions that match the picks. */
  function startTest() {
    const questions = taggedQuestions().filter(matchesPick);
    const parts = ["level", "stage", "topic", "sub"].map(function name(key) {
      const select = findElement("htrab-" + (key === "sub" ? "sub" : key));
      const text = select.selectedOptions[0];
      return state.pick[key] && text ? text.textContent : "";
    }).filter(Boolean);
    quiz.session.startQuestions(questions,
      "HTRAB: " + (parts.pop() || "all steps"));
  }

  // -------------------------------------------------------------- panel

  /**
   * One labelled drop-down.
   * @param {string} id
   * @param {string} label
   * @param {"level"|"stage"|"topic"|"sub"} key
   * @returns {HTMLElement}
   */
  function createPickerField(id, label, key) {
    const field = createElement("label", "field");
    field.id = id + "-field";
    field.appendChild(createElement("span", null, label));
    const select = createElement("select");
    select.id = id;
    select.addEventListener("change", function onChange() {
      choose(key, select.value);
    });
    field.appendChild(select);
    return field;
  }

  /**
   * The On/Off switch. One sits on the home screen (for this visit), one
   * on the Settings screen (the saved default).
   * @param {boolean} isDefault
   * @returns {HTMLElement}
   */
  function createSwitchRow(isDefault) {
    const row = createElement("div", isDefault ?
      "setting-row htrab-default" : "field htrab-switch");
    row.dataset.isDefault = String(isDefault);
    if (isDefault) {
      const label = createElement("div", "setting-label");
      label.appendChild(createElement("b", null, "HTRAB method"));
      label.appendChild(createElement("small", null,
        "Practise the reading steps of How to Read a Book."));
      row.appendChild(label);
    } else {
      row.appendChild(createElement("span", null, "HTRAB method"));
    }
    const group = createElement("div", "choice-group");
    [["off", "Off"], ["on", isDefault ? "On" : "On: practise the steps"]]
      .forEach(function addButton(entry) {
        const button = createButton(entry[1], "", function toggle() {
          if (isDefault) {
            quiz.layout.setDefault("htrab", entry[0] === "on");
          } else {
            setOn(entry[0] === "on");
          }
        });
        button.dataset.value = entry[0];
        group.appendChild(button);
      });
    row.appendChild(group);
    return row;
  }

  /** @returns {HTMLElement} the reading-step picker, shown when on */
  function createPanel() {
    const panel = createElement("div", "htrab-panel hidden");
    panel.id = "htrab-body";
    panel.appendChild(createElement("p", "note",
      "Choose a reading step from How to Read a Book. The test then " +
      "holds only questions tagged with that step."));
    panel.appendChild(createPickerField("htrab-level", "Level", "level"));
    panel.appendChild(createPickerField("htrab-stage", "Stage", "stage"));
    panel.appendChild(createPickerField("htrab-topic", "Topic", "topic"));
    panel.appendChild(createPickerField("htrab-sub", "Subtopic", "sub"));
    panel.appendChild(createElement("p", "ready-summary htrab-count"))
      .id = "htrab-count";
    const start = createButton("Start HTRAB test", "button primary",
      startTest);
    start.id = "htrab-start";
    panel.appendChild(start);
    return panel;
  }

  /**
   * Switch the method on or off and redraw the panel.
   * @param {boolean} isOn
   */
  function setOn(isOn, isQuiet) {
    state.isOn = isOn;
    if (!isQuiet) {
      document.dispatchEvent(new CustomEvent("recallquiz:practice-changed"));
    }
    refreshPanel();
    if (isOn) {
      loadData().then(refreshPanel);
    }
  }

  /** Show the right buttons, and the picker if the method is on. */
  function refreshPanel() {
    if (!state.panel) {
      return;
    }
    state.switchRows.forEach(function markRow(row) {
      const isOn = row.dataset.isDefault === "true" ?
        state.defaultOn : state.isOn;
      row.querySelectorAll(".choice-group button").forEach(
        function mark(button) {
          const isActive = (button.dataset.value === "on") === isOn;
          button.setAttribute("aria-pressed", String(isActive));
        });
    });
    const body = state.panel;
    body.classList.toggle("hidden", !state.isOn);
    if (state.isOn && state.loadFailed) {
      showLoadFailure(body);
    } else if (state.isOn && state.tree) {
      renderPicker();
    }
  }

  /** @param {HTMLElement} body  tell the reader the data did not load */
  function showLoadFailure(body) {
    findElement("htrab-count").textContent = "The HTRAB data could not " +
      "be loaded. Open the quiz through a web server (see README).";
    findElement("htrab-start").disabled = true;
    body.querySelectorAll("label").forEach(function hide(field) {
      field.classList.add("hidden");
    });
  }

  /** Add the panel to the home screen if the bank has tagged questions. */
  function installPanel() {
    if (state.panel) {
      state.panel.remove();
      state.switchRows.forEach(function drop(row) {
        row.remove();
      });
      state.switchRows = [];
      state.panel = null;
    }
    const hasTags = quiz.book.allQuestions().some(function tagged(q) {
      return Boolean(q.htrab);
    }) || quiz.learning.concepts().some(function tagged(concept) {
      return Boolean(concept.htrab);
    });
    if (!hasTags) {
      return;
    }
    state.panel = createPanel();
    state.switchRows = [createSwitchRow(false), createSwitchRow(true)];
    const anchor = findElement("keep-going-block");
    anchor.parentNode.insertBefore(state.panel, anchor);
    findElement("htrab-home-switch").appendChild(state.switchRows[0]);
    findElement("htrab-setting").appendChild(state.switchRows[1]);
    refreshPanel();
    if (state.isOn) {
      loadData().then(refreshPanel);
    }
  }

  // ------------------------------------------------- questions and advice

  /**
   * Adler's advice for a tag, most useful kinds first.
   * @param {string} tag
   * @returns {object[]}
   */
  function adviceFor(tag) {
    const items = (state.catalogue && state.catalogue[tag]) || [];
    return items.slice().sort(function byUsefulness(first, second) {
      const typeDifference = TYPE_ORDER.indexOf(first.type) -
        TYPE_ORDER.indexOf(second.type);
      return typeDifference ||
        (first.rule_no ? 0 : 1) - (second.rule_no ? 0 : 1);
    }).slice(0, MOST_ADVICE_ITEMS);
  }

  /**
   * "HTRAB: Level > Subtopic" as a small line under the question.
   * @param {object} nodes  from nodesOf
   * @returns {HTMLElement}
   */
  function createChip(nodes) {
    const chip = createElement("p", "htrab-chip");
    chip.appendChild(createElement("b", null, "HTRAB: "));
    chip.appendChild(document.createTextNode(
      nodes.level.label + " \u203a " + nodes.sub.label));
    return chip;
  }

  /**
   * A closed panel with Adler's actions, self-checks and words.
   * @param {object} nodes
   * @param {string} tag
   * @param {boolean} isOpen
   * @returns {HTMLElement|null} null when the catalogue has nothing
   */
  function createAdvicePanel(nodes, tag, isOpen) {
    const items = adviceFor(tag);
    if (items.length === 0) {
      return null;
    }
    const details = createElement("details", "htrab-advice");
    details.open = isOpen;
    details.appendChild(createElement("summary", null,
      "Adler on this step: " + nodes.sub.label));
    items.forEach(function addItem(item) {
      const entry = createElement("div", "htrab-item");
      entry.appendChild(createElement("b", null, item.title));
      entry.appendChild(createElement("p", null, item.action));
      entry.appendChild(createElement("p", "htrab-check",
        "Ask yourself: " + item.check));
      entry.appendChild(createElement("blockquote", null,
        "“" + item.quote + "”"));
      if (item.mistake) {
        entry.appendChild(createElement("p", "htrab-mistake",
          "Common slip: " + item.mistake));
      }
      details.appendChild(entry);
    });
    return details;
  }

  /**
   * Add the reading-step chip (and, on a concept card, the advice) to a
   * question on screen.
   * @param {CustomEvent} event  recallquiz:question-shown
   */
  function onQuestionShown(event) {
    const { question, cardElement } = event.detail;
    const tag = tagOf(question);
    if (!state.isOn || !state.tree || !tag) {
      return;
    }
    const nodes = nodesOf(tag);
    const meta = cardElement.querySelector(".question-meta");
    if (!nodes || !meta) {
      return;
    }
    meta.appendChild(createChip(nodes));
    if (question.kind === "lesson") {
      const advice = createAdvicePanel(nodes, tag, true);
      if (advice) {
        cardElement.querySelector(".actions").before(advice);
      }
    }
  }

  /**
   * Add Adler's advice for the question's step under the feedback.
   * @param {CustomEvent} event  recallquiz:feedback-shown
   */
  function onFeedbackShown(event) {
    const { question, result, feedback } = event.detail;
    const tag = tagOf(question);
    if (!state.isOn || !state.tree || !tag) {
      return;
    }
    const nodes = nodesOf(tag);
    const advice = nodes && createAdvicePanel(nodes, tag, result === "miss");
    if (advice) {
      feedback.querySelector(".actions").before(advice);
    }
  }

  document.addEventListener("recallquiz:book-opened", installPanel);
  document.addEventListener("recallquiz:question-shown", onQuestionShown);
  document.addEventListener("recallquiz:feedback-shown", onFeedbackShown);

  quiz.htrab = {
    tagOf,
    isOn: function isOn() { return state.isOn; },
    /** Use the choice saved in the account (does not announce a change). */
    useRemote: function useRemote(isOn) {
      setOn(isOn, true);
    },
    /** Show the saved default on the Settings switch. */
    showDefault: function showDefault(isOn) {
      state.defaultOn = isOn;
      refreshPanel();
    },
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
